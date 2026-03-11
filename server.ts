/**
 * Custom Next.js server with WebSocket proxy.
 *
 * Proxies ws://localhost:3000/api/gateway → ws://GATEWAY_URL
 * so the browser never needs to connect to the gateway directly
 * (avoids system proxy issues).
 */

import { createServer } from "http";
import next from "next";
import { RawData, WebSocket, WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789/";
const MAX_BUFFERED_MESSAGES = 100;
const UPSTREAM_CONNECT_TIMEOUT_MS = 15000;

function isForwardableCloseCode(code: number) {
  return (
    code === 1000 ||
    (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // WebSocket proxy on /api/gateway
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // Only handle our proxy path; let Next.js HMR handle the rest
    if (req.url === "/api/gateway") {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        proxyWebSocket(clientWs);
      });
    }
    // Don't handle other upgrade requests — Next.js dev server
    // handles its own HMR WebSocket internally
  });

  wss.on("error", (err) => {
    console.error("[WS Proxy] server error:", err.message);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
    console.log(`> Gateway proxy: ws://localhost:${port}/api/gateway → ${GATEWAY_URL}`);
  });
}).catch((err) => {
  console.error("Failed to prepare Next.js:", err);
  process.exit(1);
});

function proxyWebSocket(clientWs: WebSocket) {
  // Connect to the real gateway
  const upstream = new WebSocket(GATEWAY_URL);
  const bufferedMessages: Array<{ data: RawData; isBinary: boolean }> = [];

  const connectTimeout = setTimeout(() => {
    if (upstream.readyState === WebSocket.CONNECTING) {
      console.error("[WS Proxy] upstream connection timeout");
      bufferedMessages.length = 0;
      upstream.terminate();
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, "Gateway connection timeout");
      }
    }
  }, UPSTREAM_CONNECT_TIMEOUT_MS);

  upstream.on("open", () => {
    clearTimeout(connectTimeout);
    for (const message of bufferedMessages) {
      upstream.send(message.data, { binary: message.isBinary });
    }
    bufferedMessages.length = 0;
  });

  upstream.on("message", (data, isBinary) => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    } catch (err) {
      console.error("[WS Proxy] send to client failed:", (err as Error).message);
    }
  });

  upstream.on("close", (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      const textReason = reason.toString();
      if (isForwardableCloseCode(code)) {
        clientWs.close(code, textReason);
      } else {
        clientWs.close();
      }
    }
  });

  upstream.on("error", (err) => {
    console.error("[WS Proxy] upstream error:", err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, "Gateway connection error");
    }
  });

  // Client → upstream
  clientWs.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }

    if (upstream.readyState === WebSocket.CONNECTING && bufferedMessages.length < MAX_BUFFERED_MESSAGES) {
      bufferedMessages.push({ data, isBinary });
    }
  });

  clientWs.on("close", () => {
    clearTimeout(connectTimeout);
    bufferedMessages.length = 0;
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error("[WS Proxy] client error:", err.message);
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
}

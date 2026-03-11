/**
 * Production server for Agent Town (npx / standalone).
 *
 * Reads the Next.js config from the standalone build output and creates
 * an HTTP server with Next.js request handler + WebSocket proxy.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load standalone config before importing next
const requiredServerFiles = JSON.parse(
  readFileSync(join(__dirname, ".next", "required-server-files.json"), "utf-8")
);
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(
  requiredServerFiles.config
);

const { default: next } = await import("next");
const { WebSocket, WebSocketServer } = await import("ws");

const port = parseInt(process.env.PORT ?? "3000", 10);
const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789/";
const MAX_BUFFERED_MESSAGES = 100;
const UPSTREAM_CONNECT_TIMEOUT_MS = 15_000;

function isForwardableCloseCode(code) {
  return (
    code === 1000 ||
    (code >= 1001 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

process.chdir(__dirname);
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      handle(req, res);
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      if (req.url === "/api/gateway") {
        wss.handleUpgrade(req, socket, head, (clientWs) => {
          proxyWebSocket(clientWs);
        });
      }
    });

    wss.on("error", (err) => {
      console.error("[WS Proxy] server error:", err.message);
    });

    server.listen(port, () => {
      console.log("");
      console.log("  \x1b[36m\x1b[1mAgent Town\x1b[0m is running!");
      console.log("");
      console.log(`  > Local:   \x1b[4mhttp://localhost:${port}\x1b[0m`);
      console.log(`  > Gateway: ${GATEWAY_URL}`);
      console.log("");
    });
  })
  .catch((err) => {
    console.error("Failed to start Agent Town:", err);
    process.exit(1);
  });

function proxyWebSocket(clientWs) {
  const upstream = new WebSocket(GATEWAY_URL);
  const bufferedMessages = [];

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
      console.error("[WS Proxy] send to client failed:", err.message);
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

  clientWs.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }
    if (
      upstream.readyState === WebSocket.CONNECTING &&
      bufferedMessages.length < MAX_BUFFERED_MESSAGES
    ) {
      bufferedMessages.push({ data, isBinary });
    }
  });

  clientWs.on("close", () => {
    clearTimeout(connectTimeout);
    bufferedMessages.length = 0;
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
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

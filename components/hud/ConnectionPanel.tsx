"use client";

import { useState, useEffect } from "react";
import { useStudio } from "@/lib/store";
import { LS_CONFIG, STATUS_LABELS } from "@/lib/constants";
import { parseGatewayAddress } from "@/lib/utils";
import HudFlyout from "./HudFlyout";

const DEFAULT_GATEWAY = "ws://127.0.0.1:18789";
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";

export default function ConnectionPanel() {
  const { state, connect, disconnect } = useStudio();
  const [url, setUrl] = useState(DEFAULT_GATEWAY);
  const [token, setToken] = useState(DEFAULT_TOKEN);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CONFIG);
      if (raw) {
        const parsed = JSON.parse(raw) as { url?: string; token?: string };
        if (parsed.url) setUrl(parsed.url);
        if (parsed.token) setToken(parsed.token);
      }
    } catch {}
  }, []);
  const isConnected = state.connection === "connected";
  const isConnecting = state.connection === "connecting";
  const isAuthFailed = state.connection === "auth_failed";
  const isUnreachable = state.connection === "unreachable";
  const isRateLimited = state.connection === "rate_limited";

  const [error, setError] = useState("");

  const handleConnect = () => {
    setError("");
    const parsed = parseGatewayAddress(url);
    if (!parsed) {
      setError("Invalid URL. Use ws://host:port or host:port.");
      return;
    }
    connect({ url: parsed, token: token.trim() });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      handleConnect();
    }
  };

  return (
    <HudFlyout title="Connection" subtitle={`${STATUS_LABELS[state.connection]} gateway link`}>
      <div className="hud-panel__stack">
        <label className="hud-panel__label">Gateway URL</label>
        <input
          className="pixel-input hud-panel__input"
          value={url}
          onChange={(event) => { setUrl(event.target.value); setError(""); }}
          onKeyDown={handleKeyDown}
          placeholder="ws://127.0.0.1:18789"
          disabled={isConnected || isConnecting}
        />
        <label className="hud-panel__label">Token</label>
        <input
          className="pixel-input hud-panel__input"
          type="password"
          value={token}
          onChange={(event) => { setToken(event.target.value); setError(""); }}
          onKeyDown={handleKeyDown}
          placeholder="optional"
          disabled={isConnected || isConnecting}
        />
        {isAuthFailed && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Authentication failed. Token may be invalid or expired — please re-enter.
          </p>
        )}
        {isUnreachable && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Gateway is unreachable. Please check if your gateway is running.
          </p>
        )}
        {isRateLimited && !error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>
            Too many failed attempts. Please wait a moment before retrying.
          </p>
        )}
        {error && (
          <p style={{ color: "var(--pixel-red)", fontSize: "8px" }}>{error}</p>
        )}
        {!isConnected && !isConnecting ? (
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={handleConnect}
            disabled={!url.trim()}
          >
            Connect
          </button>
        ) : null}
        {isConnected ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            Disconnect
          </button>
        ) : null}
        {isConnecting ? (
          <button type="button" className="pixel-button" onClick={disconnect}>
            Cancel
          </button>
        ) : null}
      </div>
    </HudFlyout>
  );
}

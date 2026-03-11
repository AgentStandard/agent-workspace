"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";

export default function TerminalModal() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [targetSeatId, setTargetSeatId] = useState<string | undefined>(undefined);
  const { state, assignTask, prepareSessionForSeat } = useStudio();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isConnected = state.connection === "connected";

  const close = useCallback(() => {
    setOpen(false);
    setTargetSeatId(undefined);
    gameEvents.emit("terminal-closed");
  }, []);

  useEffect(() => {
    const handleOpen = async (seatId?: string) => {
      if (seatId) {
        await prepareSessionForSeat(seatId);
      }
      setTargetSeatId(seatId);
      setOpen(true);
    };
    const unsubOpen = gameEvents.on("open-terminal", (seatId) => {
      void handleOpen(seatId);
    });
    const unsubQueue = gameEvents.on("open-terminal-queue", (seatId) => {
      void handleOpen(seatId);
    });
    return () => {
      unsubOpen();
      unsubQueue();
    };
  }, [prepareSessionForSeat]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, close]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || !isConnected) return;
    assignTask(trimmed, targetSeatId);
    setInput("");
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Stop game from receiving keys while terminal is open
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 50, background: "rgba(0,0,0,0.6)", pointerEvents: "auto" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="pixel-panel"
        style={{
          width: "min(520px, 90vw)",
          padding: "20px",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "10px" }}>
            {">"} Terminal
          </div>
          <button
            className="pixel-button"
            style={{ fontSize: "8px", padding: "2px 8px" }}
            onClick={close}
          >
            ESC
          </button>
        </div>

        {/* Status */}
        {!isConnected && (
          <div
            style={{
              fontSize: "8px",
              color: "var(--pixel-red)",
              marginBottom: "12px",
              padding: "6px",
              border: "2px solid var(--pixel-red)",
              borderRadius: "var(--pixel-radius-sm)",
            }}
          >
            Not connected. Use the HUD to connect first.
          </div>
        )}

        {/* Input */}
        <div style={{ marginBottom: "12px" }}>
          <textarea
            ref={inputRef}
            className="pixel-input"
            placeholder={isConnected ? "Describe task..." : "Connect first..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
            style={{ minHeight: "48px" }}
          />
          <button
            className="pixel-button pixel-button--primary w-full"
            style={{ marginTop: "8px" }}
            onClick={handleSubmit}
            disabled={!isConnected || !input.trim()}
          >
            Assign
          </button>
        </div>

      </div>
    </div>
  );
}

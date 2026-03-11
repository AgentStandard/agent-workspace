"use client";

import { Sparkles, Users } from "lucide-react";
import { STATUS_LABELS, formatModelLabel } from "@/lib/constants";
import type { ConnectionStatus, SessionMetrics, SeatState } from "@/types/game";
import ContextMeter from "./ContextMeter";

interface BottomBarProps {
  connection: ConnectionStatus;
  sessionMetrics: SessionMetrics;
  seats: SeatState[];
}

export default function BottomBar({ connection, sessionMetrics, seats }: BottomBarProps) {
  const totalSeats = seats.length;
  const assignedSeats = seats.filter((s) => s.assigned).length;
  const workingCount = seats.filter(
    (s) => s.assigned && (s.status === "running" || s.status === "returning"),
  ).length;

  return (
    <div className="layout-bottombar">
      <div className="hud-pill hud-pill--connection">
        <span
          className={`pixel-dot pixel-dot--${
            connection === "connected"
              ? "green"
              : connection === "connecting"
                ? "yellow"
                : "red"
          }`}
        />
        <span>{STATUS_LABELS[connection]}</span>
      </div>
      <div className="hud-pill hud-pill--model">
        <Sparkles size={10} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {formatModelLabel(sessionMetrics.model)}
        </span>
      </div>
      <ContextMeter
        usedTokens={sessionMetrics.usedTokens}
        maxTokens={sessionMetrics.maxContextTokens}
        fresh={sessionMetrics.fresh}
        inline
      />
      <div className="hud-pill hud-pill--metric">
        <Users size={10} />
        <span>{assignedSeats}/{totalSeats} seat</span>
      </div>
      <div className="hud-pill hud-pill--metric">
        <Sparkles size={10} />
        <span>{workingCount}/{assignedSeats} busy</span>
      </div>
    </div>
  );
}

"use client";

import type { SeatState } from "@/types/game";
import HudFlyout from "./HudFlyout";

function seatStatusLabel(seat: SeatState) {
  if (!seat.assigned) return "vacant";
  if (seat.status === "empty") return "idle";
  return seat.status;
}

function SeatGroup({ title, seats }: { title: string; seats: SeatState[] }) {
  if (seats.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 7, color: "var(--pixel-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        {title}
      </div>
      {seats.map((seat) => (
        <div key={seat.seatId} className="hud-workers__item">
          <div className="hud-workers__top">
            <span className={`hud-status hud-status--${seat.status}`}>{seatStatusLabel(seat)}</span>
            <span>
              {seat.assigned ? seat.label : "Vacant Seat"}
              {seat.seatType === "agent" && seat.agentConfig?.agentId && (
                <span style={{ fontSize: 7, color: "var(--pixel-accent)", marginLeft: 6 }}>
                  [{seat.agentConfig.agentId}]
                </span>
              )}
            </span>
          </div>
          <div className="hud-workers__task">
            {seat.assigned
              ? seat.taskSnippet ?? `${seat.roleTitle ?? (seat.seatType === "agent" ? "Agent" : "Worker")} waiting at desk`
              : "Assign a crew member to this seat"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WorkerPanel({
  seats,
  onOpenManager,
}: {
  seats: SeatState[];
  onOpenManager: () => void;
}) {
  const assigned = seats.filter((s) => s.assigned).length;
  const working = seats.filter((s) => s.assigned && (s.status === "running" || s.status === "returning")).length;
  const agentSeats = seats.filter((s) => s.seatType === "agent");
  const workerSeats = seats.filter((s) => s.seatType !== "agent");

  return (
    <HudFlyout
      title="Employees"
      subtitle={`${working}/${assigned} busy · ${assigned}/${seats.length} seat`}
      headerAction={
        <button
          type="button"
          className="pixel-button pixel-button--primary"
          style={{ fontSize: 7, padding: "4px 8px" }}
          onClick={onOpenManager}
        >
          Manage Seats
        </button>
      }
    >
      <div className="hud-workers">
        <SeatGroup title={`Agents (${agentSeats.length})`} seats={agentSeats} />
        <SeatGroup title={`Workers (${workerSeats.length})`} seats={workerSeats} />
      </div>
    </HudFlyout>
  );
}

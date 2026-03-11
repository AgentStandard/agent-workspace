"use client";

import Image from "next/image";
import type { SeatState } from "@/types/game";
import type { HudPanelId, HudDockItem } from "./HudDock";
import CharacterPortrait from "./CharacterPortrait";

interface TopBarProps {
  seats: SeatState[];
  toolItems: HudDockItem[];
  openPanel: HudPanelId | null;
  onToggle: (id: HudPanelId) => void;
  iconOverrides?: Partial<Record<HudPanelId, string>>;
  onSeatClick?: (seatId: string) => void;
}

function seatDotColor(seat: SeatState): string {
  if (!seat.assigned) return "gray";
  if (seat.status === "running" || seat.status === "returning") return "yellow";
  if (seat.status === "failed") return "red";
  return "green";
}

export default function TopBar({
  seats,
  toolItems,
  openPanel,
  onToggle,
  iconOverrides,
  onSeatClick,
}: TopBarProps) {
  const assignedSeats = seats.filter((s) => s.assigned);

  return (
    <div className="layout-top">
      {/* Left: logo */}
      <div className="layout-topbar__title">
        <span className="layout-topbar__logo">✦ AGENT WORKSPACE</span>
      </div>

      {/* Center: agent pills (each pill is its own floating element) */}
      <div className="layout-topbar__agents">
        {assignedSeats.map((seat) => (
          <button
            key={seat.seatId}
            type="button"
            className={`topbar-agent-pill ${
              seat.status === "running" || seat.status === "returning"
                ? "topbar-agent-pill--active"
                : ""
            }`}
            onClick={() => onSeatClick?.(seat.seatId)}
            title={`${seat.label} — ${seat.status}`}
          >
            <div className="topbar-agent-pill__avatar">
              <CharacterPortrait spritePath={seat.spritePath} name={seat.label} />
            </div>
            <span className="topbar-agent-pill__name">{seat.label}</span>
            <span className={`pixel-dot pixel-dot--${seatDotColor(seat)}`} />
          </button>
        ))}
        {assignedSeats.length === 0 && (
          <span className="topbar-agent-pill__empty">No agents assigned</span>
        )}
      </div>

      {/* Right: tool buttons group */}
      <div className="layout-topbar__tools">
        {toolItems.map((item) => {
          const active = openPanel === item.id;
          const override = iconOverrides?.[item.id];
          const src = override ?? (active ? item.iconActive : item.icon);
          return (
            <button
              key={item.id}
              type="button"
              data-dock-id={item.id}
              onClick={() => onToggle(item.id)}
              title={item.label}
              className={`topbar-tool-btn ${active ? "topbar-tool-btn--active" : ""}`}
            >
              <Image
                src={src}
                alt={item.label}
                width={24}
                height={24}
                style={{ imageRendering: "pixelated", display: "block" }}
                unoptimized
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

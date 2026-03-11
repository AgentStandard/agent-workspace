"use client";

import dynamic from "next/dynamic";
import { StudioProvider } from "@/lib/store";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import TerminalModal from "@/components/panel/TerminalModal";
import WorkerSessionHistoryModal from "@/components/panel/WorkerSessionHistoryModal";
import GameHud from "@/components/hud/GameHud";

const PhaserGame = dynamic(() => import("@/components/game/PhaserGame"), {
  ssr: false,
});

export default function Page() {
  return (
    <ErrorBoundary>
      <StudioProvider>
        <main
          className="relative w-screen h-screen overflow-hidden"
          style={{ background: "var(--pixel-bg)", width: "100vw", height: "100vh", position: "fixed", inset: 0 }}
        >
          {/* Game canvas — full screen background, explicit dimensions so Phaser.Scale.RESIZE works */}
          <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <PhaserGame />
          </div>
          {/* HUD overlay — floating UI on top */}
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
            <GameHud />
          </div>
          <TerminalModal />
          <WorkerSessionHistoryModal />
        </main>
      </StudioProvider>
    </ErrorBoundary>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BGM_VOLUME } from "@/lib/constants";
import { loadBgmVolume, saveBgmVolume } from "@/lib/persistence";

// Track list — rotate through these
const BGM_TRACKS = [
  "/audio/bgm.mp3",
  "/audio/bgm2.mp3",
];

const FADE_DURATION = 2000; // 2s crossfade between tracks

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BGM_VOLUME;
  return Math.min(1, Math.max(0, value));
}

export interface BgmState {
  volume: number;
  setVolume: (percent: number) => void;
  trackIndex: number;
  trackCount: number;
}

export function useBgm(): BgmState {
  const [volume, setVolume] = useState(DEFAULT_BGM_VOLUME);
  const [trackIndex, setTrackIndex] = useState(0);
  const volumeRef = useRef(volume);
  const trackIndexRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadingRef = useRef(false);

  volumeRef.current = volume;
  trackIndexRef.current = trackIndex;

  // Crossfade to next track
  const advanceTrack = useCallback(() => {
    if (fadingRef.current) return;
    fadingRef.current = true;

    const current = audioRef.current;
    const nextIndex = (trackIndexRef.current + 1) % BGM_TRACKS.length;
    const next = new Audio(BGM_TRACKS[nextIndex]);
    next.volume = 0;
    next.preload = "auto";

    next.play().then(() => {
      setTrackIndex(nextIndex);
      const targetVol = volumeRef.current;
      const steps = 20;
      const stepTime = FADE_DURATION / steps;
      let step = 0;

      const ticker = setInterval(() => {
        step++;
        const t = step / steps;
        next.volume = Math.min(targetVol, t * targetVol);
        if (current) current.volume = Math.max(0, targetVol * (1 - t));

        if (step >= steps) {
          clearInterval(ticker);
          if (current) { current.pause(); current.src = ""; }
          audioRef.current = next;
          fadingRef.current = false;
        }
      }, stepTime);
    }).catch(() => { fadingRef.current = false; });
  }, []);

  // Init on first mount
  useEffect(() => {
    const saved = clampVolume(loadBgmVolume());
    setVolume(saved);

    const audio = new Audio(BGM_TRACKS[0]);
    audio.volume = saved;
    audio.preload = "auto";
    audioRef.current = audio;

    // Auto-advance to next track when current ends
    audio.addEventListener("ended", advanceTrack);

    if (saved > 0) {
      audio.play().catch(() => {
        // Unlock on first interaction
        const unlock = () => {
          if (volumeRef.current > 0) audioRef.current?.play().catch(() => {});
        };
        window.addEventListener("pointerdown", unlock, { once: true, passive: true });
        window.addEventListener("keydown", unlock, { once: true });
      });
    }

    return () => {
      audio.pause();
      audio.src = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep volume in sync when changed
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    if (volume > 0 && audio.paused) {
      audio.play().catch(() => {});
    }
  }, [volume]);

  const changeVolume = useCallback((percent: number) => {
    const v = clampVolume(percent / 100);
    setVolume(v);
    saveBgmVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  return { volume, setVolume: changeVolume, trackIndex, trackCount: BGM_TRACKS.length };
}

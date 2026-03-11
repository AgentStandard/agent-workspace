"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BGM_VOLUME } from "@/lib/constants";
import { loadBgmVolume, saveBgmVolume } from "@/lib/persistence";

const BGM_SRC = "/audio/bgm.mp3";

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BGM_VOLUME;
  return Math.min(1, Math.max(0, value));
}

let sharedAudio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(BGM_SRC);
    sharedAudio.loop = true;
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

export interface BgmState {
  volume: number;
  setVolume: (percent: number) => void;
}

export function useBgm(): BgmState {
  const [volume, setVolume] = useState(DEFAULT_BGM_VOLUME);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    const saved = clampVolume(loadBgmVolume());
    setVolume(saved);
    const audio = getAudio();
    audio.volume = saved;
    if (saved > 0) {
      audio.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (volume <= 0) return;
    const audio = getAudio();
    if (audio.paused) {
      const unlock = () => {
        if (volumeRef.current > 0) audio.play().catch(() => {});
      };
      window.addEventListener("pointerdown", unlock, { once: true, passive: true });
      window.addEventListener("keydown", unlock, { once: true });
      return () => {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      };
    }
  }, [volume]);

  const changeVolume = useCallback((percent: number) => {
    const v = clampVolume(percent / 100);
    setVolume(v);
    saveBgmVolume(v);
    const audio = getAudio();
    audio.volume = v;
    if (v > 0 && audio.paused) {
      audio.play().catch(() => {});
    }
  }, []);

  return { volume, setVolume: changeVolume };
}

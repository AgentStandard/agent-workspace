/**
 * Character spritesheet animation configuration.
 *
 * All Premade_Character_48x48_XX.png sheets share the same layout:
 *   48×96 frames, 56 cols × ~20 rows
 *     Row 0: preview/idle thumbnails
 *     Row 1: idle — right(6) · up(6) · left(6) · down(6)
 *     Row 2: walk — right(6) · up(6) · left(6) · down(6)
 */

export const FRAME_WIDTH = 48;
export const FRAME_HEIGHT = 96;
export const SHEET_COLUMNS = 56;

const FRAMES_PER_DIR = 6;

/** Pixel/sec movement speed */
export const MOVE_SPEED = 130;

export interface AnimDef {
  key: string;
  start: number;
  end: number;
  frameRate: number;
  repeat: number;
}

// Kept for compatibility with Player.ts (unused in workspace mode but avoids TS errors)
export const BOSS_SPRITE_KEY = "character_09";
export const BOSS_SPRITE_PATH = "/characters/Premade_Character_48x48_09.png";
export const SPRITE_KEY = BOSS_SPRITE_KEY;
export const SPRITE_PATH = BOSS_SPRITE_PATH;

export interface WorkerSpriteConfig {
  key: string;
  path: string;
  /** Agent display name */
  label: string;
  /** Hex tint colour applied via Phaser setTint() */
  tint: number;
  /** Short role descriptor shown in HUD */
  role: string;
}

/**
 * AgentStandard agent team — 8 agents mapped to the 7 available
 * sprite sheets. Pulse reuses char_04 with a distinct coral tint.
 */
export const WORKER_SPRITES: WorkerSpriteConfig[] = [
  { key: "character_01", path: "/characters/Premade_Character_48x48_01.png", label: "Aspera",   tint: 0xCCEEFF, role: "coordinator"    }, // star-white celestial
  { key: "character_02", path: "/characters/Premade_Character_48x48_02.png", label: "Griffin",  tint: 0xFFCC44, role: "credit research" }, // amber fire-being
  { key: "character_03", path: "/characters/Premade_Character_48x48_03.png", label: "Harper",   tint: 0xFF88BB, role: "PA & inbox"      }, // rose crystal
  { key: "character_04", path: "/characters/Premade_Character_48x48_04.png", label: "Sigma",    tint: 0x44FF99, role: "quant"           }, // neon bioluminescent
  { key: "character_05", path: "/characters/Premade_Character_48x48_05.png", label: "Atlas",    tint: 0x99BBDD, role: "portfolio"       }, // cold slate monolith
  { key: "character_06", path: "/characters/Premade_Character_48x48_06.png", label: "Vega",     tint: 0xDD88FF, role: "strategy"        }, // violet nebula
  { key: "character_09", path: "/characters/Premade_Character_48x48_09.png", label: "Meridian", tint: 0x5566EE, role: "briefing"        }, // deep indigo void
  { key: "character_04_pulse", path: "/characters/Premade_Character_48x48_04.png", label: "Pulse", tint: 0xFF5533, role: "social"       }, // hot coral plasma
];

const directions = ["right", "up", "left", "down"] as const;
export type Direction = (typeof directions)[number];

export function makeAnims(spriteKey: string, prefix: string, row: number, frameRate: number): AnimDef[] {
  return directions.map((dir, i) => ({
    key: `${spriteKey}:${prefix}-${dir}`,
    start: row * SHEET_COLUMNS + i * FRAMES_PER_DIR,
    end: row * SHEET_COLUMNS + i * FRAMES_PER_DIR + FRAMES_PER_DIR - 1,
    frameRate,
    repeat: -1,
  }));
}

// Boss anims (kept for Player.ts compatibility)
function rowAnims(prefix: string, row: number, frameRate: number): AnimDef[] {
  return directions.map((dir, i) => ({
    key: `${prefix}-${dir}`,
    start: row * SHEET_COLUMNS + i * FRAMES_PER_DIR,
    end: row * SHEET_COLUMNS + i * FRAMES_PER_DIR + FRAMES_PER_DIR - 1,
    frameRate,
    repeat: -1,
  }));
}

export const IDLE_ANIMS = rowAnims("idle", 1, 8);
export const WALK_ANIMS = rowAnims("walk", 2, 10);
export const ALL_ANIMS: AnimDef[] = [...IDLE_ANIMS, ...WALK_ANIMS];

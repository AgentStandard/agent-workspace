/**
 * OfficeScene — AgentStandard Agent Workspace
 *
 * Fork of Agent Town (MIT). Stripped of RPG player + interaction mechanics.
 * Fixed overview camera showing the whole office. 8 named agents wander,
 * sit at desks, and reflect live state via emotes + chat bubbles.
 */

import * as Phaser from "phaser";
import { Worker, resetWanderClock, type POI } from "../entities/Worker";
import {
  SPRITE_KEY,
  SPRITE_PATH,
  WORKER_SPRITES,
} from "../config/animations";
import {
  EMOTE_SHEET_KEY,
  EMOTE_SHEET_PATH,
  EMOTE_FRAME_SIZE,
} from "../config/emotes";
import { Pathfinder } from "../utils/Pathfinder";
import {
  buildSpriteFrames,
  parseSpawns,
  parsePOIs,
  buildCollisionRects,
  renderTileObjectLayer,
  type AnimatedProp,
  type SeatDef,
} from "../utils/MapHelpers";
import { gameEvents } from "@/lib/events";
import {
  PF_PADDING,
  ZOOM_SENSITIVITY,
  ZOOM_MIN,
  ZOOM_MAX,
  CAMERA_DRAG_THRESHOLD,
} from "@/lib/constants";
import type { SeatState } from "@/types/game";

// Overview zoom — show the full office
const OVERVIEW_ZOOM = 0.72;

export class OfficeScene extends Phaser.Scene {
  private gameEventUnsubs: Array<() => void> = [];

  private workers: Worker[] = [];
  private runWorkerMap = new Map<string, Worker>();
  private sessionBindings = new Map<string, string>();
  private seatDefs: SeatDef[] = [];
  private collisionGroup!: Phaser.Physics.Arcade.StaticGroup;
  private pathfinder!: Pathfinder;
  private pois: POI[] = [];

  private doors: { sprite: Phaser.GameObjects.Sprite; x: number; y: number; open: boolean }[] = [];

  private mapWidth = 0;
  private mapHeight = 0;
  private cameraDragging = false;

  constructor() {
    super({ key: "OfficeScene" });
  }

  // ── Preload ─────────────────────────────────────────────

  preload() {
    this.load.tilemapTiledJSON("office", "/maps/office2.json");

    this.load.once("filecomplete-tilemapJSON-office", () => {
      const cached = this.cache.tilemap.get("office");
      if (!cached?.data?.tilesets) return;
      for (const ts of cached.data.tilesets) {
        const basename = (ts.image as string).split("/").pop()!;
        this.load.image(ts.name, `/tilesets/${basename}`);
      }
    });

    // Load all unique character sprite sheets (Pulse reuses char_04 sheet)
    const loadedPaths = new Set<string>();
    for (const ws of WORKER_SPRITES) {
      if (!loadedPaths.has(ws.path)) {
        this.load.image(ws.key, ws.path);
        loadedPaths.add(ws.path);
      } else {
        // Alias the already-loaded sheet under the alternate key
        this.load.image(ws.key, ws.path);
      }
    }

    // Legacy key needed by buildSpriteFrames internals
    this.load.image(SPRITE_KEY, SPRITE_PATH);

    this.load.spritesheet(EMOTE_SHEET_KEY, EMOTE_SHEET_PATH, {
      frameWidth: EMOTE_FRAME_SIZE,
      frameHeight: EMOTE_FRAME_SIZE,
    });

    this.load.spritesheet("anim-cauldron", "/sprites/animated_witch_cauldron_48x48.png", {
      frameWidth: 96,
      frameHeight: 96,
    });

    this.load.spritesheet("anim-door", "/sprites/animated_door_big_4_48x48.png", {
      frameWidth: 48,
      frameHeight: 144,
    });
  }

  // ── Create ──────────────────────────────────────────────

  create() {
    // Build sprite animation frames for all character sheets
    buildSpriteFrames(this, SPRITE_KEY);
    for (const ws of WORKER_SPRITES) {
      buildSpriteFrames(this, ws.key);
    }

    const map = this.make.tilemap({ key: "office" });
    const allTilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of map.tilesets) {
      const added = map.addTilesetImage(ts.name, ts.name);
      if (added) allTilesets.push(added);
    }
    if (allTilesets.length === 0) {
      console.error("[OfficeScene] No tilesets loaded");
      return;
    }

    // Render map layers
    map.createLayer("floor",     allTilesets);
    map.createLayer("walls",     allTilesets);
    map.createLayer("ground",    allTilesets);
    map.createLayer("furniture", allTilesets);
    map.createLayer("objects",   allTilesets);

    const animatedProps: AnimatedProp[] = [
      {
        tilesetName: "11_Halloween_48x48",
        anchorLocalId: 130,
        skipLocalIds: new Set([130, 131, 146, 147]),
        spriteKey: "anim-cauldron",
        frameWidth: 96,
        frameHeight: 96,
        endFrame: 11,
        frameRate: 8,
      },
    ];
    renderTileObjectLayer(this, map, "props",      allTilesets, 5, animatedProps);
    renderTileObjectLayer(this, map, "props-over", allTilesets, 11);

    const overheadLayer = map.createLayer("overhead", allTilesets);
    if (overheadLayer) overheadLayer.setDepth(10);

    // Collision + pathfinding
    this.collisionGroup = this.physics.add.staticGroup();
    const collisionRects = buildCollisionRects(map, this.collisionGroup);
    this.pathfinder = new Pathfinder(map.widthInPixels, map.heightInPixels, collisionRects, PF_PADDING);

    this.mapWidth  = map.widthInPixels;
    this.mapHeight = map.heightInPixels;

    // Parse spawns — treat bossSpawn as the 8th agent seat
    const { bossSpawn, workerSpawns } = parseSpawns(map);
    const bossAsSeat: SeatDef = {
      seatId: "seat-boss",
      x: bossSpawn.x,
      y: bossSpawn.y,
      facing: bossSpawn.facing,
      index: workerSpawns.length,
    };
    // All 8 spawn slots (7 worker + 1 boss repurposed)
    this.seatDefs = [...workerSpawns, bossAsSeat];

    // POIs (whiteboard, sofa, coffee, etc.) — workers wander to these when idle
    this.pois = parsePOIs(map);
    resetWanderClock();

    // Doors
    this.initDoors();

    // Physics world bounds
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // ── Camera: fixed overview, no player follow ────────
    const cam = this.cameras.main;
    cam.setBackgroundColor("#1a1814");
    cam.setRoundPixels(true);
    cam.setZoom(OVERVIEW_ZOOM);
    cam.centerOn(map.widthInPixels / 2, map.heightInPixels / 2);
    this.updateCameraBounds();
    this.scale.on("resize", () => this.updateCameraBounds());

    // Zoom via scroll wheel
    const canvas = this.game.canvas;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.ctrlKey ? e.deltaY * 3 : e.deltaY;
      const oldZoom = cam.zoom;
      const newZoom = Phaser.Math.Clamp(oldZoom - delta * ZOOM_SENSITIVITY, ZOOM_MIN, ZOOM_MAX);
      if (newZoom === oldZoom) return;
      const sx = e.offsetX / cam.scaleManager.displayScale.x;
      const sy = e.offsetY / cam.scaleManager.displayScale.y;
      const worldBefore = cam.getWorldPoint(sx, sy);
      cam.setZoom(newZoom);
      this.updateCameraBounds();
      const worldAfter = cam.getWorldPoint(sx, sy);
      cam.scrollX += worldBefore.x - worldAfter.x;
      cam.scrollY += worldBefore.y - worldAfter.y;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.events.once("shutdown", () => canvas.removeEventListener("wheel", onWheel));

    // Pan by dragging
    this.initCameraDrag(cam);

    // Wire game events
    this.initGameEvents();

    // Auto-spawn all 8 agents immediately using the WORKER_SPRITES config
    this.autoSpawnAgents();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY,  () => this.cleanup());
  }

  // ── Auto-spawn agents ───────────────────────────────────

  private autoSpawnAgents() {
    const seats = this.seatDefs.slice(0, WORKER_SPRITES.length);
    for (let i = 0; i < seats.length; i++) {
      const seatDef = seats[i];
      const agentConfig = WORKER_SPRITES[i];
      const worker = new Worker(
        this,
        seatDef.x,
        seatDef.y,
        agentConfig.key,
        seatDef.seatId,
        agentConfig.label,
        seatDef.facing,
      );
      // Apply brand tint to distinguish agents
      worker.sprite.setTint(agentConfig.tint);
      worker.setPOIs(this.pois);
      worker.setPathfinder(this.pathfinder);
      worker.sprite.setCollideWorldBounds(true);
      this.workers.push(worker);
    }
    // Emit seats so HUD panels can update
    gameEvents.emit("seats-discovered", this.seatDefs);
  }

  // ── Camera ──────────────────────────────────────────────

  private initCameraDrag(cam: Phaser.Cameras.Scene2D.Camera) {
    let lastX = 0;
    let lastY = 0;

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.cameraDragging = true;
        lastX = pointer.x;
        lastY = pointer.y;
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.cameraDragging || !pointer.leftButtonDown()) return;
      const dx = lastX - pointer.x;
      const dy = lastY - pointer.y;
      lastX = pointer.x;
      lastY = pointer.y;
      if (Math.abs(dx) > CAMERA_DRAG_THRESHOLD || Math.abs(dy) > CAMERA_DRAG_THRESHOLD) {
        cam.scrollX += dx / cam.zoom;
        cam.scrollY += dy / cam.zoom;
      }
    });
    this.input.on("pointerup", () => { this.cameraDragging = false; });
  }

  private updateCameraBounds() {
    const cam = this.cameras.main;
    const viewW = cam.width  / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const mw = this.mapWidth;
    const mh = this.mapHeight;
    const bx = viewW > mw ? -(viewW - mw) / 2 : 0;
    const by = viewH > mh ? -(viewH - mh) / 2 : 0;
    const bw = viewW > mw ? viewW : mw;
    const bh = viewH > mh ? viewH : mh;
    cam.setBounds(bx, by, bw, bh);
  }

  // ── Worker helpers ──────────────────────────────────────

  private syncWorkers(seats: SeatState[]) {
    const nextBySeatId = new Map(
      seats.filter(s => s.assigned && s.spriteKey).map(s => [s.seatId, s])
    );
    const existingBySeatId = new Map(this.workers.map(w => [w.seatId, w]));
    const nextWorkers: Worker[] = [];

    for (const seatDef of this.seatDefs) {
      const seat     = nextBySeatId.get(seatDef.seatId);
      const existing = existingBySeatId.get(seatDef.seatId);
      if (!seat) {
        if (existing) { this.cleanupWorker(existing); existingBySeatId.delete(seatDef.seatId); }
        continue;
      }
      if (!existing || existing.spriteKey !== seat.spriteKey || existing.label !== seat.label) {
        if (existing) { this.cleanupWorker(existing); existingBySeatId.delete(seatDef.seatId); }
        const w = this.spawnWorker(seatDef, seat);
        if (w) nextWorkers.push(w);
      } else {
        nextWorkers.push(existing);
        existingBySeatId.delete(seatDef.seatId);
      }
    }
    for (const stale of existingBySeatId.values()) this.cleanupWorker(stale);
    this.workers = nextWorkers;
  }

  private spawnWorker(seatDef: SeatDef, seat: SeatState): Worker | null {
    if (!seat.spriteKey) return null;
    const agentConfig = WORKER_SPRITES.find(ws => ws.key === seat.spriteKey);
    const worker = new Worker(this, seatDef.x, seatDef.y, seat.spriteKey, seatDef.seatId, seat.label, seatDef.facing);
    if (agentConfig) worker.sprite.setTint(agentConfig.tint);
    worker.setPOIs(this.pois);
    worker.setPathfinder(this.pathfinder);
    worker.sprite.setCollideWorldBounds(true);
    return worker;
  }

  private cleanupWorker(worker: Worker) {
    if (worker.assignedRunId) this.runWorkerMap.delete(worker.assignedRunId);
    for (const task of worker.taskQueue) this.runWorkerMap.delete(task.runId);
    worker.destroy();
  }

  private findWorkerBySeatId(seatId?: string): Worker | null {
    if (!seatId) return null;
    return this.workers.find(w => w.seatId === seatId) ?? null;
  }

  private findIdleWorker(): Worker | null {
    return this.workers.find(w => w.status === "idle") ?? null;
  }

  // ── Doors ───────────────────────────────────────────────

  private initDoors() {
    const doorPositions = [{ x: 528, y: 528 }, { x: 960, y: 528 }];

    if (!this.anims.exists("door-open")) {
      this.anims.create({ key: "door-open",  frames: this.anims.generateFrameNumbers("anim-door", { start: 0, end: 4 }), frameRate: 10, repeat: 0 });
      this.anims.create({ key: "door-close", frames: this.anims.generateFrameNumbers("anim-door", { start: 4, end: 0 }), frameRate: 10, repeat: 0 });
    }
    for (const pos of doorPositions) {
      const sprite = this.add.sprite(pos.x, pos.y, "anim-door", 0).setOrigin(0, 0).setDepth(4);
      this.doors.push({ sprite, x: pos.x + 24, y: pos.y + 48, open: false });
    }
  }

  private updateDoors() {
    const threshold = 60;
    for (const door of this.doors) {
      let near = false;
      for (const w of this.workers) {
        const dx = w.sprite.x - door.x;
        const dy = w.sprite.y - door.y;
        if (dx * dx + dy * dy < threshold * threshold) { near = true; break; }
      }
      if (near && !door.open)  { door.open = true;  door.sprite.play("door-open");  }
      if (!near && door.open)  { door.open = false; door.sprite.play("door-close"); }
    }
  }

  // ── Game events ─────────────────────────────────────────

  private initGameEvents() {
    for (const unsub of this.gameEventUnsubs) unsub();
    this.gameEventUnsubs = [];

    this.gameEventUnsubs.push(gameEvents.on("seat-configs-updated", (seats) => {
      this.syncWorkers(seats);
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-assigned", (taskId, message, seatId, sessionKey) => {
      const boundSeatId = sessionKey ? this.sessionBindings.get(sessionKey) : undefined;
      const targetSeatId = seatId ?? boundSeatId;
      const worker = this.findWorkerBySeatId(targetSeatId) ?? this.findIdleWorker();
      if (!worker) {
        gameEvents.emit("task-ready", taskId, message, seatId);
        return;
      }
      if (sessionKey) this.sessionBindings.set(sessionKey, worker.seatId);
      gameEvents.emit("task-routed", taskId, worker.seatId, worker.label);
      if (worker.status === "working" && worker.assignedRunId) {
        gameEvents.emit("task-staged", taskId, "queued", worker.seatId);
        worker.enqueueTask(taskId, message, () => gameEvents.emit("task-ready", taskId, message, worker.seatId));
        this.runWorkerMap.set(taskId, worker);
        return;
      }
      if (worker.isAwayFromDesk()) gameEvents.emit("task-staged", taskId, "returning", worker.seatId);
      worker.assignTask(taskId, message, () => gameEvents.emit("task-ready", taskId, message, worker.seatId));
      this.runWorkerMap.set(taskId, worker);
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-bound", (taskId, runId) => {
      const worker = this.runWorkerMap.get(taskId);
      if (!worker) return;
      worker.rebindAssignedRun(taskId, runId);
      this.runWorkerMap.delete(taskId);
      this.runWorkerMap.set(runId, worker);
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-bubble", (runId, text, ttl) => {
      this.runWorkerMap.get(runId)?.showBubble(text, ttl ?? 5000);
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-completed", (runId) => {
      const worker = this.runWorkerMap.get(runId);
      if (worker) { worker.completeTask(); this.runWorkerMap.delete(runId); }
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-failed", (runId) => {
      const worker = this.runWorkerMap.get(runId);
      if (worker) { worker.failTask(); this.runWorkerMap.delete(runId); }
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-aborted", (runId) => {
      const worker = this.runWorkerMap.get(runId);
      if (!worker) return;
      if (worker.abortTask(runId)) this.runWorkerMap.delete(runId);
    }));

    this.gameEventUnsubs.push(gameEvents.on("subagent-assigned", (runId, _parentRunId, label) => {
      const worker = this.findIdleWorker();
      if (!worker) return;
      worker.assignTask(runId, `[Sub] ${label}`);
      this.runWorkerMap.set(runId, worker);
    }));

    this.gameEventUnsubs.push(gameEvents.on("terminal-closed", () => {}));
  }

  private cleanup() {
    for (const unsub of this.gameEventUnsubs) unsub();
    this.gameEventUnsubs = [];
    for (const worker of this.workers) worker.destroy();
    this.workers = [];
    this.runWorkerMap.clear();
  }

  // ── Update ──────────────────────────────────────────────

  update() {
    for (const worker of this.workers) worker.update();
    this.updateDoors();
  }
}

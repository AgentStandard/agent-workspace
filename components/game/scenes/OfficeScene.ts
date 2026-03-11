import * as Phaser from "phaser";
import { Player } from "../entities/Player";
import { Worker, resetWanderClock, type POI } from "../entities/Worker";
import { InteractionMenu, type MenuOption } from "../entities/InteractionMenu";
import {
  SPRITE_KEY,
  SPRITE_PATH,
  FRAME_HEIGHT,
  WORKER_SPRITES,
  type Direction,
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
  INTERACT_DISTANCE,
  BOSS_INTERACT_DISTANCE,
  PF_PADDING,
  PRESS_E_STYLE,
  BOSS_PROMPT_OFFSET_X,
  BOSS_PROMPT_OFFSET_Y,
  CAMERA_LERP,
  ZOOM_SENSITIVITY,
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  CAMERA_DRAG_THRESHOLD,
  PROMPT_Y_OFFSET,
} from "@/lib/constants";
import type { SeatState } from "@/types/game";

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

export class OfficeScene extends Phaser.Scene {
  private player!: Player;
  private terminalZone: { x: number; y: number } | null = null;
  private promptText: Phaser.GameObjects.Text | null = null;
  private eKey!: Phaser.Input.Keyboard.Key;
  private terminalOpen = false;
  private gameEventUnsubs: Array<() => void> = [];

  private workers: Worker[] = [];
  private runWorkerMap = new Map<string, Worker>();
  /** sessionKey -> seatId: when a character executes a task, that session binds to the character */
  private sessionBindings = new Map<string, string>();
  private seatDefs: SeatDef[] = [];
  private collisionGroup!: Phaser.Physics.Arcade.StaticGroup;
  private pathfinder!: Pathfinder;
  private pois: POI[] = [];

  private doors: { sprite: Phaser.GameObjects.Sprite; x: number; y: number; open: boolean }[] = [];

  /** Interaction system */
  private interactionMenu!: InteractionMenu;
  private nearestWorker: Worker | null = null;
  private workerPromptText: Phaser.GameObjects.Text | null = null;
  private menuOpen = false;

  constructor() {
    super({ key: "OfficeScene" });
  }

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

    this.load.image(SPRITE_KEY, SPRITE_PATH);

    for (const ws of WORKER_SPRITES) {
      this.load.image(ws.key, ws.path);
    }

    this.load.spritesheet(EMOTE_SHEET_KEY, EMOTE_SHEET_PATH, {
      frameWidth: EMOTE_FRAME_SIZE,
      frameHeight: EMOTE_FRAME_SIZE,
    });

    this.load.spritesheet("boss-arrow", "/sprites/arrow_down_48x48.png", {
      frameWidth: 48,
      frameHeight: 48,
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

  create() {
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

    map.createLayer("floor", allTilesets);
    map.createLayer("walls", allTilesets);
    map.createLayer("ground", allTilesets);
    map.createLayer("furniture", allTilesets);
    map.createLayer("objects", allTilesets);

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
    renderTileObjectLayer(this, map, "props", allTilesets, 5, animatedProps);
    renderTileObjectLayer(this, map, "props-over", allTilesets, 11);

    const overheadLayer = map.createLayer("overhead", allTilesets);
    if (overheadLayer) overheadLayer.setDepth(10);

    this.collisionGroup = this.physics.add.staticGroup();
    const collisionRects = buildCollisionRects(map, this.collisionGroup);

    this.pathfinder = new Pathfinder(map.widthInPixels, map.heightInPixels, collisionRects, PF_PADDING);

    const { bossSpawn, workerSpawns } = parseSpawns(map);
    this.seatDefs = workerSpawns;

    this.player = new Player(this, bossSpawn.x, bossSpawn.y, bossSpawn.facing);
    this.physics.add.collider(this.player.sprite, this.collisionGroup);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.sprite.setCollideWorldBounds(true);

    this.input.keyboard?.disableGlobalCapture();

    this.mapWidth = map.widthInPixels;
    this.mapHeight = map.heightInPixels;

    const cam = this.cameras.main;
    cam.setBackgroundColor("#1a1814");
    cam.setRoundPixels(true);
    cam.setZoom(ZOOM_DEFAULT);
    this.updateCameraBounds();
    cam.startFollow(this.player.sprite, true, CAMERA_LERP, CAMERA_LERP);

    this.scale.on("resize", () => this.updateCameraBounds());

    const canvas = this.game.canvas;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.ctrlKey ? e.deltaY * 3 : e.deltaY;
      const oldZoom = cam.zoom;
      const newZoom = Phaser.Math.Clamp(oldZoom - delta * ZOOM_SENSITIVITY, ZOOM_MIN, ZOOM_MAX);
      if (newZoom === oldZoom) return;

      if (!this.cameraFollowing) {
        const sx = e.offsetX / cam.scaleManager.displayScale.x;
        const sy = e.offsetY / cam.scaleManager.displayScale.y;
        const worldBefore = cam.getWorldPoint(sx, sy);
        cam.setZoom(newZoom);
        this.updateCameraBounds();
        const worldAfter = cam.getWorldPoint(sx, sy);
        cam.scrollX += worldBefore.x - worldAfter.x;
        cam.scrollY += worldBefore.y - worldAfter.y;
      } else {
        cam.setZoom(newZoom);
        this.updateCameraBounds();
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.events.once("shutdown", () => canvas.removeEventListener("wheel", onWheel));

    this.initCameraDrag(cam);

    this.pois = parsePOIs(map);
    resetWanderClock();
    this.initDoors();
    this.initBossSeat(bossSpawn);
    this.initInteractionUI();
    this.initGameEvents();
    gameEvents.emit("seats-discovered", workerSpawns);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  // ── Camera drag ─────────────────────────────────────────

  private cameraDragging = false;
  private cameraFollowing = true;
  private mapWidth = 0;
  private mapHeight = 0;

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
        if (this.cameraFollowing) {
          cam.stopFollow();
          this.cameraFollowing = false;
        }
        cam.scrollX += dx / cam.zoom;
        cam.scrollY += dy / cam.zoom;
      }
    });

    this.input.on("pointerup", () => {
      this.cameraDragging = false;
    });
  }

  private resumeCameraFollow() {
    if (!this.cameraFollowing) {
      this.cameras.main.startFollow(this.player.sprite, true, CAMERA_LERP, CAMERA_LERP);
      this.cameraFollowing = true;
    }
  }

  /** Recalculate camera bounds so the map is centered when viewport > map at current zoom. */
  private updateCameraBounds() {
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const mw = this.mapWidth;
    const mh = this.mapHeight;

    const bx = viewW > mw ? -(viewW - mw) / 2 : 0;
    const by = viewH > mh ? -(viewH - mh) / 2 : 0;
    const bw = viewW > mw ? viewW : mw;
    const bh = viewH > mh ? viewH : mh;

    cam.setBounds(bx, by, bw, bh);
  }

  // ── Workers ──────────────────────────────────────────────

  private cleanupWorkerRunIds(worker: Worker) {
    if (worker.assignedRunId) this.runWorkerMap.delete(worker.assignedRunId);
    for (const task of worker.taskQueue) {
      this.runWorkerMap.delete(task.runId);
    }
  }

  private spawnWorker(seatDef: SeatDef, seat: SeatState) {
    if (!seat.spriteKey) return null;
    const initialFacing: Direction = seatDef.facing;
    const worker = new Worker(
      this,
      seatDef.x,
      seatDef.y,
      seat.spriteKey,
      seatDef.seatId,
      seat.label,
      initialFacing,
    );
    worker.setPOIs(this.pois);
    worker.setPathfinder(this.pathfinder);
    worker.sprite.setCollideWorldBounds(true);
    return worker;
  }

  private syncWorkers(seats: SeatState[]) {
    const nextBySeatId = new Map(
      seats
        .filter((seat) => seat.assigned && seat.spriteKey)
        .map((seat) => [seat.seatId, seat]),
    );
    const existingBySeatId = new Map(this.workers.map((worker) => [worker.seatId, worker]));
    const nextWorkers: Worker[] = [];

    for (const seatDef of this.seatDefs) {
      const seat = nextBySeatId.get(seatDef.seatId);
      const existing = existingBySeatId.get(seatDef.seatId);

      if (!seat) {
        if (existing) {
          this.cleanupWorkerRunIds(existing);
          if (this.nearestWorker === existing) this.nearestWorker = null;
          existing.destroy();
          existingBySeatId.delete(seatDef.seatId);
        }
        continue;
      }

      const needsRecreate =
        !existing ||
        existing.spriteKey !== seat.spriteKey ||
        existing.label !== seat.label;

      if (needsRecreate) {
        if (existing) {
          this.cleanupWorkerRunIds(existing);
          if (this.nearestWorker === existing) this.nearestWorker = null;
          existing.destroy();
          existingBySeatId.delete(seatDef.seatId);
        }
        const created = this.spawnWorker(seatDef, seat);
        if (created) nextWorkers.push(created);
        continue;
      }

      nextWorkers.push(existing);
      existingBySeatId.delete(seatDef.seatId);
    }

    for (const stale of existingBySeatId.values()) {
      this.cleanupWorkerRunIds(stale);
      if (this.nearestWorker === stale) this.nearestWorker = null;
      stale.destroy();
    }

    this.workers = nextWorkers;
  }

  // ── Interaction UI ───────────────────────────────────────

  private initInteractionUI() {
    this.workerPromptText = this.add
      .text(0, 0, "Press E", PRESS_E_STYLE as Phaser.Types.GameObjects.Text.TextStyle)
      .setResolution(window.devicePixelRatio * 2)
      .setOrigin(0.5, 1)
      .setDepth(25)
      .setVisible(false);
    this.workerPromptText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    this.interactionMenu = new InteractionMenu(this);
    this.interactionMenu.onClose = () => {
      this.menuOpen = false;
      this.resumeCameraFollow();
    };
  }

  private findNearestWorker(): Worker | null {
    let nearest: Worker | null = null;
    let minDist = Infinity;

    for (const worker of this.workers) {
      if (!worker.canInteract()) continue;
      const dist = Phaser.Math.Distance.Between(
        this.player.sprite.x, this.player.sprite.y,
        worker.sprite.x, worker.sprite.y,
      );
      if (dist < INTERACT_DISTANCE && dist < minDist) {
        minDist = dist;
        nearest = worker;
      }
    }
    return nearest;
  }

  private openWorkerMenu(worker: Worker) {
    this.menuOpen = true;

    const isWorking = worker.status === "working";
    const isIdle = worker.status === "idle" || worker.status === "done";

    const options: MenuOption[] = [
      {
        label: "Assign Task",
        enabled: true,
        action: () => {
          this.menuOpen = false;
          if (isIdle) {
            gameEvents.emit("open-terminal", worker.seatId);
          } else {
            gameEvents.emit("open-terminal-queue", worker.seatId);
          }
        },
      },
      {
        label: "New Session",
        enabled: true,
        action: () => {
          this.menuOpen = false;
          gameEvents.emit("new-session-for-seat", worker.seatId);
        },
      },
      {
        label: "Session History",
        enabled: true,
        action: () => {
          this.menuOpen = false;
          gameEvents.emit("open-session-history", worker.seatId);
        },
      },
      {
        label: "Stop Task",
        enabled: isWorking,
        action: () => {
          this.menuOpen = false;
          if (worker.assignedRunId) {
            gameEvents.emit("stop-task", worker.assignedRunId, worker.seatId);
          }
        },
      },
      {
        label: "Cancel",
        enabled: true,
        action: () => {
          this.menuOpen = false;
        },
      },
    ];

    if (worker.taskQueue.length > 0) {
      options.splice(2, 0, {
        label: `Queue (${worker.taskQueue.length})`,
        enabled: false,
        action: () => {},
      });
    }

    this.interactionMenu.show(worker.sprite.x, worker.sprite.y, options);
  }

  // ── Game events bridge ─────────────────────────────────

  private initGameEvents() {
    for (const unsub of this.gameEventUnsubs) unsub();
    this.gameEventUnsubs = [];

    this.gameEventUnsubs.push(gameEvents.on("seat-configs-updated", (seats) => {
      this.syncWorkers(seats);
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-assigned", (taskId, message, seatId, sessionKey) => {
      // Route by explicit seatId, or by session binding (session -> character), or find idle worker
      const boundSeatId = sessionKey ? this.sessionBindings.get(sessionKey) : undefined;
      const targetSeatId = seatId ?? boundSeatId;
      const worker = this.findWorkerBySeatId(targetSeatId) ?? this.findIdleWorker();
      if (!worker) {
        gameEvents.emit("task-ready", taskId, message, seatId);
        return;
      }
      // Bind session to character when character gets the task
      if (sessionKey) this.sessionBindings.set(sessionKey, worker.seatId);
      gameEvents.emit("task-routed", taskId, worker.seatId, worker.label);
      // When routed to this worker (explicit seat or session-bound) and they're busy: queue on worker
      if (worker.status === "working" && worker.assignedRunId) {
        gameEvents.emit("task-staged", taskId, "queued", worker.seatId);
        worker.enqueueTask(taskId, message, () => gameEvents.emit("task-ready", taskId, message, worker.seatId));
        this.runWorkerMap.set(taskId, worker);
        return;
      }

      if (worker.isAwayFromDesk()) {
        gameEvents.emit("task-staged", taskId, "returning", worker.seatId);
      }

      const ready = () => gameEvents.emit("task-ready", taskId, message, worker.seatId);
      worker.assignTask(taskId, message, ready);
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
      const worker = this.runWorkerMap.get(runId);
      if (worker) worker.showBubble(text, ttl ?? 5000);
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-completed", (runId) => {
      const worker = this.runWorkerMap.get(runId);
      if (worker) {
        worker.completeTask();
        this.runWorkerMap.delete(runId);
      }
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-failed", (runId) => {
      const worker = this.runWorkerMap.get(runId);
      if (worker) {
        worker.failTask();
        this.runWorkerMap.delete(runId);
      }
    }));

    this.gameEventUnsubs.push(gameEvents.on("task-aborted", (runId) => {
      const worker = this.runWorkerMap.get(runId);
      if (!worker) return;
      if (worker.abortTask(runId)) {
        this.runWorkerMap.delete(runId);
      }
    }));

    this.gameEventUnsubs.push(gameEvents.on("subagent-assigned", (runId, _parentRunId, label) => {
      const worker = this.findIdleWorker();
      if (!worker) return;
      worker.assignTask(runId, `[Sub] ${label}`);
      this.runWorkerMap.set(runId, worker);
    }));

    this.gameEventUnsubs.push(gameEvents.on("terminal-closed", () => {
      this.terminalOpen = false;
    }));
  }

  private cleanup() {
    for (const unsub of this.gameEventUnsubs) unsub();
    this.gameEventUnsubs = [];

    for (const worker of this.workers) worker.destroy();
    this.workers = [];
    this.runWorkerMap.clear();
    this.nearestWorker = null;

    this.interactionMenu?.destroy();
  }

  private findWorkerBySeatId(seatId?: string): Worker | null {
    if (!seatId) return null;
    return this.workers.find((worker) => worker.seatId === seatId) ?? null;
  }

  private findIdleWorker(): Worker | null {
    return this.workers.find((worker) => worker.status === "idle") ?? null;
  }

  // ── Boss seat ──────────────────────────────────────────

  private initDoors() {
    const doorPositions = [
      { x: 528, y: 528 },
      { x: 960, y: 528 },
    ];

    if (!this.anims.exists("door-open")) {
      this.anims.create({
        key: "door-open",
        frames: this.anims.generateFrameNumbers("anim-door", { start: 0, end: 4 }),
        frameRate: 10,
        repeat: 0,
      });
      this.anims.create({
        key: "door-close",
        frames: this.anims.generateFrameNumbers("anim-door", { start: 4, end: 0 }),
        frameRate: 10,
        repeat: 0,
      });
    }

    for (const pos of doorPositions) {
      const sprite = this.add
        .sprite(pos.x, pos.y, "anim-door", 0)
        .setOrigin(0, 0)
        .setDepth(4);
      this.doors.push({ sprite, x: pos.x + 24, y: pos.y + 48, open: false });
    }
  }

  private updateDoors() {
    const threshold = 60;
    for (const door of this.doors) {
      let near = false;
      const dx = this.player.sprite.x - door.x;
      const dy = this.player.sprite.y - door.y;
      if (dx * dx + dy * dy < threshold * threshold) {
        near = true;
      }
      if (!near) {
        for (const w of this.workers) {
          const wx = w.sprite.x - door.x;
          const wy = w.sprite.y - door.y;
          if (wx * wx + wy * wy < threshold * threshold) {
            near = true;
            break;
          }
        }
      }
      if (near && !door.open) {
        door.open = true;
        door.sprite.play("door-open");
      } else if (!near && door.open) {
        door.open = false;
        door.sprite.play("door-close");
      }
    }
  }

  private initBossSeat(bossSpawn: { x: number; y: number }) {
    this.terminalZone = { x: bossSpawn.x, y: bossSpawn.y };

    this.promptText = this.add
      .text(bossSpawn.x + BOSS_PROMPT_OFFSET_X, bossSpawn.y - BOSS_PROMPT_OFFSET_Y, "Press E", PRESS_E_STYLE as Phaser.Types.GameObjects.Text.TextStyle)
      .setResolution(window.devicePixelRatio * 2)
      .setOrigin(0, 0)
      .setDepth(20)
      .setVisible(false);
    this.promptText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);

    const kb = this.input.keyboard;
    if (!kb) return;
    this.eKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
  }

  // ── Update ─────────────────────────────────────────────

  update() {
    if (this.interactionMenu.visible) {
      this.interactionMenu.update();
      for (const worker of this.workers) worker.update();
      return;
    }

    if (this.terminalOpen || isInputFocused()) {
      for (const worker of this.workers) worker.update();
      this.updateDoors();
      return;
    }

    this.player.update();
    if (!this.cameraFollowing && this.player.isMoving()) {
      this.resumeCameraFollow();
    }
    for (const worker of this.workers) worker.update();
    this.updateDoors();

    // Worker proximity detection
    const nearest = this.findNearestWorker();

    if (nearest !== this.nearestWorker) {
      if (this.nearestWorker) this.nearestWorker.resume();
      this.nearestWorker = nearest;
    }

    if (this.workerPromptText) {
      if (nearest) {
        nearest.pause();
        this.workerPromptText.setPosition(
          nearest.sprite.x,
          nearest.sprite.y - FRAME_HEIGHT * PROMPT_Y_OFFSET,
        );
        this.workerPromptText.setVisible(true);
      } else {
        this.workerPromptText.setVisible(false);
      }
    }

    // E key: worker menu takes priority over boss terminal
    if (nearest && Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.openWorkerMenu(nearest);
      if (this.workerPromptText) this.workerPromptText.setVisible(false);
      return;
    }

    // Boss terminal interaction (only when no worker is nearby)
    if (!nearest && this.terminalZone && this.promptText) {
      const dist = Phaser.Math.Distance.Between(
        this.player.sprite.x, this.player.sprite.y,
        this.terminalZone.x, this.terminalZone.y,
      );
      const near = dist < BOSS_INTERACT_DISTANCE;
      this.promptText.setVisible(near);

      if (near && Phaser.Input.Keyboard.JustDown(this.eKey)) {
        this.terminalOpen = true;
        this.promptText.setVisible(false);
        gameEvents.emit("open-terminal");
      }
    } else if (this.promptText) {
      this.promptText.setVisible(false);
    }
  }
}

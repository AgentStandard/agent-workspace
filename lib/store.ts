"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type Dispatch,
  type ReactNode,
} from "react";
import React from "react";
import type { SeatState, TaskItem, GatewayConfig, ChatMessage } from "@/types/game";
import type { StudioSnapshot } from "@/types/game";
import { GatewayClient } from "./gateway";
import type { GatewayFrame } from "./gateway-types";
import type { ModelChoice } from "./gateway-handler";
import { wireGatewayClient, loadSessionPreview } from "./gateway-handler";
import { gameEvents } from "./events";
import { getDefaultGatewayUrl } from "./utils";
import {
  type PersistedSeatConfig,
  loadGatewayConfig,
  saveGatewayConfig,
  loadActiveSessionKey,
  saveActiveSessionKey,
  loadTasks,
  loadChat,
  loadSessions,
  loadSeatConfigs,
  saveTasks,
  saveChat,
  saveSessions,
  saveSeatConfigs,
} from "./persistence";
import {
  type Action,
  reducer,
  initialState,
  chatId,
  findTask,
  generateSessionKey,
  resolveSeatLabelForTask,
  mergeDiscoveredSeats,
  MAIN_SESSION_KEY,
  createEmptySessionMetrics,
} from "./reducer";

// ── Context ────────────────────────────────────────────

interface StudioContextValue {
  state: StudioSnapshot;
  connect: (config?: GatewayConfig) => void;
  disconnect: () => void;
  assignTask: (message: string, seatId?: string) => void;
  updateSeatConfig: (seatId: string, patch: Partial<SeatState>) => void;
  newSession: () => void;
  switchSession: (sessionKey: string) => void;
  prepareSessionForSeat: (seatId: string) => Promise<void>;
  newSessionForSeat: (seatId: string) => void;
  getBoundSessionForSeat: (seatId: string) => string | undefined;
  loadSessionChat: (sessionKey: string) => Promise<ChatMessage[]>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────

const DEFAULT_URL = getDefaultGatewayUrl();
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const dispatchRef = useRef<Dispatch<Action>>(dispatch);
  dispatchRef.current = dispatch;
  const tasksRef = useRef<TaskItem[]>(state.tasks);
  tasksRef.current = state.tasks;
  const seatsRef = useRef<SeatState[]>(state.seats);
  seatsRef.current = state.seats;
  const seatConfigRef = useRef<PersistedSeatConfig[]>([]);

  const clientRef = useRef<GatewayClient | null>(null);
  const configRef = useRef<GatewayConfig>({ url: DEFAULT_URL, token: DEFAULT_TOKEN });
  const activeSessionKeyRef = useRef<string | undefined>(undefined);
  const seatIdToSessionKeyRef = useRef(new Map<string, string>());
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskCounterRef = useRef(0);

  // Shared refs for gateway handler
  const seenStartsRef = useRef(new Set<string>());
  const stoppedRunIdsRef = useRef(new Set<string>());
  const bubbleAccumRef = useRef(new Map<string, string>());
  const bubbleThrottleTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runActorRef = useRef(new Map<string, string>());
  const modelCatalogRef = useRef<ModelChoice[] | null>(null);

  const setActiveSessionKey = useCallback((sessionKey?: string) => {
    activeSessionKeyRef.current = sessionKey;
    saveActiveSessionKey(sessionKey);
    dispatchRef.current({ type: "SET_ACTIVE_SESSION", sessionKey });
  }, []);

  // ── Connect implementation ──

  const connectImpl = useCallback((cfg: GatewayConfig) => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }

    configRef.current = cfg;
    modelCatalogRef.current = null;

    const client = new GatewayClient(cfg.url, cfg.token);
    clientRef.current = client;

    wireGatewayClient(client, {
      dispatch: () => dispatchRef.current,
      tasks: () => tasksRef.current,
      seats: () => seatsRef.current,
      activeSessionKey: () => activeSessionKeyRef.current,
      setActiveSessionKey,
      seenStarts: seenStartsRef.current,
      stoppedRunIds: stoppedRunIdsRef.current,
      bubbleAccum: bubbleAccumRef.current,
      bubbleThrottleTimers: bubbleThrottleTimersRef.current,
      runActors: runActorRef.current,
      modelCatalog: modelCatalogRef,
      sessionRefreshTimer: sessionRefreshTimerRef,
      taskCounter: taskCounterRef,
    });

    client
      .connect()
      .then(() => {
        saveGatewayConfig(cfg);
      })
      .catch((err) => {
        console.warn("[Gateway] connect failed:", err.message);
        // Don't overwrite terminal states already set by the client (auth_failed, unreachable, rate_limited)
        const terminalStates = new Set(["auth_failed", "unreachable", "rate_limited"]);
        if (!terminalStates.has(client.status)) {
          dispatchRef.current({ type: "SET_CONNECTION", status: "error" });
        }
        dispatchRef.current({
          type: "APPEND_CHAT",
          message: {
            id: chatId(), runId: "", role: "system",
            content: `Connection failed: ${err.message}`,
            timestamp: new Date().toISOString(),
            sessionKey: activeSessionKeyRef.current ?? MAIN_SESSION_KEY,
          },
        });
      });
  }, [setActiveSessionKey]);

  // ── Bootstrap: restore state + auto-connect ──

  useEffect(() => {
    const savedConfig = loadGatewayConfig();
    if (savedConfig) configRef.current = savedConfig;

    const savedActiveKey = loadActiveSessionKey();
    const fallbackSessionKey = savedActiveKey ?? MAIN_SESSION_KEY;
    const tasks = loadTasks(fallbackSessionKey);
    const chat = loadChat(fallbackSessionKey);
    const sessions = loadSessions();
    const seatConfigs = loadSeatConfigs();
    seatConfigRef.current = seatConfigs;
    const hasRestoredData = tasks.length > 0 || chat.length > 0 || sessions.length > 0;
    // Always set the ref so gateway handler doesn't override with a different key
    activeSessionKeyRef.current = savedActiveKey ?? (hasRestoredData ? MAIN_SESSION_KEY : undefined);
    if (hasRestoredData) {
      dispatch({ type: "RESTORE", tasks, chatMessages: chat, sessions, activeSessionKey: fallbackSessionKey });
    }
    if (activeSessionKeyRef.current) {
      dispatch({ type: "SET_ACTIVE_SESSION", sessionKey: activeSessionKeyRef.current });
      saveActiveSessionKey(activeSessionKeyRef.current);
    }

    // Pre-populate seenStarts with runIds of in-flight tasks so gateway handler
    // processes subsequent events (tool, assistant delta) correctly.
    const inflightTasks = tasks.filter(
      (t) => t.status === "running" || t.status === "submitted" || t.status === "returning",
    );
    for (const t of inflightTasks) {
      if (t.runId) seenStartsRef.current.add(t.runId);
      seenStartsRef.current.add(t.taskId);
      // Restore actor names so bubbles/chat show the right label
      if (t.actorName && t.runId) runActorRef.current.set(t.runId, t.actorName);
    }

    // When seats are discovered from the map, re-bind any in-flight tasks to their seats
    const unsubSeats = gameEvents.on("seats-discovered", (discovered) => {
      const mergedSeats = mergeDiscoveredSeats(discovered, seatConfigRef.current, seatsRef.current);
      dispatchRef.current({ type: "SYNC_SEATS", seats: mergedSeats });

      // Re-bind running tasks to seats after discovery
      for (const task of tasksRef.current) {
        if (
          task.seatId &&
          (task.status === "running" || task.status === "submitted" || task.status === "returning")
        ) {
          dispatchRef.current({
            type: "PATCH_SEAT_RUNTIME",
            seatId: task.seatId,
            patch: {
              status: task.status === "returning" ? "returning" : "running",
              runId: task.runId ?? task.taskId,
              taskSnippet: task.message.slice(0, 28),
              startedAt: task.createdAt,
            },
          });
        }
      }
    });

    // Stale task timeout: if no gateway events arrive for a restored in-flight task
    // within 20 seconds after reconnect, mark it as interrupted.
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    if (inflightTasks.length > 0) {
      staleTimer = setTimeout(() => {
        for (const t of inflightTasks) {
          const current = findTask(tasksRef.current, t.taskId);
          if (current && (current.status === "running" || current.status === "submitted" || current.status === "returning")) {
            // Check if the task has received any new content since restore
            // by comparing the runId — if it's still the same, likely stale
            dispatchRef.current({
              type: "UPDATE_TASK",
              taskId: current.taskId,
              patch: { status: "interrupted", completedAt: new Date().toISOString() },
            });
            if (current.runId) {
              dispatchRef.current({ type: "SET_SEAT_STATUS", runId: current.runId, status: "empty" });
            }
          }
        }
      }, 20_000);
    }

    if (savedConfig?.url) {
      const t = setTimeout(() => connectImpl(savedConfig), 80);
      return () => {
        clearTimeout(t);
        if (staleTimer) clearTimeout(staleTimer);
        unsubSeats();
      };
    }
    return () => {
      if (staleTimer) clearTimeout(staleTimer);
      unsubSeats();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist tasks + chat + sessions ──

  useEffect(() => {
    saveTasks(state.tasks);
    saveChat(state.chatMessages);
    saveSessions(state.sessions);
  }, [state.tasks, state.chatMessages, state.sessions]);

  useEffect(() => {
    const configs: PersistedSeatConfig[] = state.seats.map((seat) => ({
      seatId: seat.seatId,
      label: seat.label,
      seatType: seat.seatType,
      roleTitle: seat.roleTitle,
      assigned: seat.assigned,
      spriteKey: seat.spriteKey,
      spritePath: seat.spritePath,
      agentConfig: seat.agentConfig,
    }));
    seatConfigRef.current = configs;
    saveSeatConfigs(configs);
    gameEvents.emit("seat-configs-updated", state.seats);
  }, [state.seats]);

  // ── Cleanup ──

  useEffect(() => {
    return () => {
      if (sessionRefreshTimerRef.current) {
        clearTimeout(sessionRefreshTimerRef.current);
      }
      for (const timer of bubbleThrottleTimersRef.current.values()) {
        clearTimeout(timer);
      }
      clientRef.current?.disconnect();
    };
  }, []);

  // ── Task routing via gateway ──
  // Session queue: Openclaw doesn't allow same session multiple tasks in parallel. Queue on frontend.
  const sessionQueueRef = useRef<Map<string, Array<{ taskId: string; message: string; seatId?: string }>>>(new Map());

  const sendTaskToGateway = useCallback((taskId: string, message: string, seatId?: string) => {
    const client = clientRef.current;
    if (!client || client.status !== "connected") return;
    const task = findTask(tasksRef.current, taskId);

    // For agent-type seats, use the agent's own session key
    const seat = seatId ? seatsRef.current.find((s) => s.seatId === seatId) : undefined;
    const isAgentSeat = seat?.seatType === "agent" && seat.agentConfig?.agentId;
    const sessionKey = isAgentSeat
      ? `agent:${seat!.agentConfig!.agentId}:main`
      : (task?.sessionKey ?? activeSessionKeyRef.current ?? MAIN_SESSION_KEY);
    const actorName = task?.actorName ?? resolveSeatLabelForTask(seatsRef.current, seatId);

    dispatchRef.current({ type: "UPDATE_TASK", taskId, patch: { status: "submitted" } });
    if (seatId) {
      dispatchRef.current({
        type: "PATCH_SEAT_RUNTIME",
        seatId,
        patch: {
          status: "running",
          taskSnippet: message.slice(0, 28),
          startedAt: new Date().toISOString(),
        },
      });
    }

    // Use chat.send (not agent) so chat.abort can stop the run — agent runs are not in chatAbortControllers
    client
      .request("chat.send", {
        sessionKey,
        message,
        idempotencyKey: taskId,
      })
      .then((res: GatewayFrame) => {
        const runId = (res.payload?.runId as string) ?? undefined;
        const finalRunId = runId ?? taskId;
        if (actorName) {
          runActorRef.current.set(finalRunId, actorName);
          dispatchRef.current({ type: "SET_RUN_ACTOR", runId: finalRunId, actorName });
        }
        dispatchRef.current({
          type: "UPDATE_TASK",
          taskId,
          patch: { status: "running", runId: runId ?? undefined, actorName, seatId },
        });
        dispatchRef.current({ type: "BIND_SEAT_RUN", taskId, runId: finalRunId });
        gameEvents.emit("task-bound", taskId, finalRunId);
      })
      .catch((err: Error) => {
        console.error("[Gateway] assign failed:", err);
        dispatchRef.current({ type: "UPDATE_TASK", taskId, patch: { status: "failed" } });
        dispatchRef.current({ type: "SET_SEAT_STATUS", runId: taskId, status: "failed" });
        gameEvents.emit("task-failed", taskId);
        dispatchRef.current({
          type: "APPEND_CHAT",
          message: {
            id: chatId(), runId: taskId, role: "system",
            content: `Assign failed: ${err.message}`,
            timestamp: new Date().toISOString(),
            sessionKey,
          },
        });
      });
  }, []);

  const drainSessionQueue = useCallback(
    (sessionKey: string) => {
      const queue = sessionQueueRef.current.get(sessionKey);
      if (!queue || queue.length === 0) return;
      const next = queue.shift()!;
      if (queue.length === 0) sessionQueueRef.current.delete(sessionKey);
      sendTaskToGateway(next.taskId, next.message, next.seatId);
    },
    [sendTaskToGateway],
  );

  useEffect(() => {
    return gameEvents.on("task-ready", (taskId, message, seatId) => {
      const task = findTask(tasksRef.current, taskId);
      const sessionKey = task?.sessionKey ?? activeSessionKeyRef.current ?? MAIN_SESSION_KEY;
      const hasRunning = tasksRef.current.some(
        (t) =>
          t.sessionKey === sessionKey &&
          t.taskId !== taskId &&
          (t.status === "running" || t.status === "submitted")
      );
      if (hasRunning) {
        const queue = sessionQueueRef.current.get(sessionKey) ?? [];
        queue.push({ taskId, message, seatId });
        sessionQueueRef.current.set(sessionKey, queue);
        return;
      }
      sendTaskToGateway(taskId, message, seatId);
    });
  }, [sendTaskToGateway]);

  useEffect(() => {
    const drain = (runId: string) => {
      const task = findTask(tasksRef.current, runId);
      if (task?.sessionKey) drainSessionQueue(task.sessionKey);
    };
    const unsubComplete = gameEvents.on("task-completed", drain);
    const unsubFailed = gameEvents.on("task-failed", drain);
    const unsubAborted = gameEvents.on("task-aborted", drain);
    return () => {
      unsubComplete();
      unsubFailed();
      unsubAborted();
    };
  }, [drainSessionQueue]);

  useEffect(() => {
    return gameEvents.on("task-routed", (taskId, seatId, actorName) => {
      dispatchRef.current({ type: "UPDATE_TASK", taskId, patch: { seatId, actorName } });
      const task = findTask(tasksRef.current, taskId);
      if (task?.sessionKey) seatIdToSessionKeyRef.current.set(seatId, task.sessionKey);
    });
  }, []);

  useEffect(() => {
    return gameEvents.on("task-staged", (taskId, stage, seatId) => {
      dispatchRef.current({ type: "UPDATE_TASK", taskId, patch: { status: stage, seatId } });
      if (!seatId) return;
      dispatchRef.current({
        type: "PATCH_SEAT_RUNTIME",
        seatId,
        patch: {
          status: stage === "returning" ? "returning" : "running",
          runId: taskId,
          taskSnippet: stage === "returning" ? "Returning to desk..." : "Queued task",
          startedAt: new Date().toISOString(),
        },
      });
    });
  }, []);

  // ── Public API ──

  const connect = useCallback(
    (config?: GatewayConfig) => {
      connectImpl(config ?? configRef.current);
    },
    [connectImpl],
  );

  const disconnect = useCallback(() => {
    if (sessionRefreshTimerRef.current) {
      clearTimeout(sessionRefreshTimerRef.current);
      sessionRefreshTimerRef.current = null;
    }
    clientRef.current?.disconnect();
    clientRef.current = null;
    setActiveSessionKey(undefined);
    dispatchRef.current({ type: "SET_SESSION_METRICS", metrics: createEmptySessionMetrics() });
  }, [setActiveSessionKey]);

  const updateSeatConfig = useCallback((seatId: string, patch: Partial<SeatState>) => {
    dispatchRef.current({ type: "UPDATE_SEAT_CONFIG", seatId, patch });
  }, []);

  const assignTask = useCallback((message: string, seatId?: string) => {
    const client = clientRef.current;
    if (!client || client.status !== "connected") return;

    const taskId = `aw_task_${++taskCounterRef.current}_${Date.now()}`;
    const sessionKey = activeSessionKeyRef.current ?? MAIN_SESSION_KEY;
    const actorName = seatId ? resolveSeatLabelForTask(seatsRef.current, seatId) : undefined;

    dispatchRef.current({
      type: "ADD_TASK",
      task: { taskId, message, status: "submitted", sessionKey, seatId, actorName, createdAt: new Date().toISOString() },
    });
    dispatchRef.current({
      type: "APPEND_CHAT",
      message: { id: chatId(), runId: taskId, role: "user", content: message, timestamp: new Date().toISOString(), sessionKey },
    });
    gameEvents.emit("task-assigned", taskId, message, seatId, sessionKey);
  }, []);

  const finalizeStoppedTask = useCallback((runId: string, seatId?: string) => {
    const task = findTask(tasksRef.current, runId);
    if (!task || task.status === "stopped" || task.status === "completed") return;
    stoppedRunIdsRef.current.add(task.runId ?? task.taskId);
    dispatchRef.current({
      type: "UPDATE_TASK", taskId: runId,
      patch: { status: "stopped", completedAt: new Date().toISOString(), result: task.result ?? "Stopped by user" },
    });
    if (seatId) {
      dispatchRef.current({
        type: "PATCH_SEAT_RUNTIME", seatId,
        patch: { status: "empty", runId: undefined, taskSnippet: undefined, startedAt: undefined },
      });
    } else {
      dispatchRef.current({ type: "SET_SEAT_STATUS", runId, status: "empty" });
    }
    dispatchRef.current({
      type: "APPEND_CHAT",
      message: { id: chatId(), runId, role: "system", content: "Task stopped", timestamp: new Date().toISOString(), sessionKey: task.sessionKey },
    });
    gameEvents.emit("task-aborted", runId);
  }, []);

  useEffect(() => {
    return gameEvents.on("stop-task", async (runId, seatId) => {
      const task = findTask(tasksRef.current, runId);
      if (!task) return;
      if (task.status === "queued" || task.status === "returning" || !task.runId) {
        finalizeStoppedTask(runId, seatId);
        return;
      }

      const client = clientRef.current;
      if (!client || client.status !== "connected") {
        finalizeStoppedTask(runId, seatId);
        return;
      }

      // Optimistically finalize FIRST so we discard any in-flight gateway events (deltas, final)
      finalizeStoppedTask(runId, seatId);
      try {
        await client.request("chat.abort", { sessionKey: task.sessionKey, runId: task.runId }, 10000);
      } catch {
        dispatchRef.current({
          type: "APPEND_CHAT",
          message: {
            id: chatId(), runId, role: "system",
            content: "Stop task failed: gateway rejected the stop request",
            timestamp: new Date().toISOString(),
            sessionKey: task.sessionKey,
          },
        });
      }
    });
  }, [finalizeStoppedTask]);

  const newSession = useCallback(() => {
    const newKey = generateSessionKey();
    const record = {
      key: newKey,
      label: `Session ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: new Date().toISOString(),
    };

    bubbleAccumRef.current.clear();
    seenStartsRef.current.clear();
    dispatchRef.current({ type: "NEW_SESSION", session: record });
    activeSessionKeyRef.current = newKey;
    saveActiveSessionKey(newKey);
  }, []);

  const switchSession = useCallback(async (sessionKey: string) => {
    if (sessionKey === activeSessionKeyRef.current) return;

    bubbleAccumRef.current.clear();
    seenStartsRef.current.clear();
    saveActiveSessionKey(sessionKey);

    // Dispatch first to update Redux, then sync ref — single source of truth
    dispatchRef.current({ type: "SWITCH_SESSION", sessionKey });
    activeSessionKeyRef.current = sessionKey;

    const client = clientRef.current;
    let messages: Awaited<ReturnType<typeof loadSessionPreview>> = [];
    try {
      messages = client ? await loadSessionPreview(client, sessionKey) : [];
    } catch (err) {
      console.error("[Store] loadSessionPreview failed:", err);
    }

    // Guard: user may have switched again while we were loading
    if (activeSessionKeyRef.current !== sessionKey) return;
    dispatchRef.current({ type: "HYDRATE_SESSION_CHAT", sessionKey, chatMessages: messages });
  }, []);

  const prepareSessionForSeat = useCallback(
    async (seatId: string) => {
      const bound = seatIdToSessionKeyRef.current.get(seatId);
      if (bound) {
        await switchSession(bound);
      } else {
        newSession();
        seatIdToSessionKeyRef.current.set(seatId, activeSessionKeyRef.current ?? MAIN_SESSION_KEY);
      }
    },
    [newSession, switchSession],
  );

  const newSessionForSeat = useCallback((seatId: string) => {
    newSession();
    const newKey = activeSessionKeyRef.current ?? MAIN_SESSION_KEY;
    seatIdToSessionKeyRef.current.set(seatId, newKey);
  }, [newSession]);

  const getBoundSessionForSeat = useCallback((seatId: string) => {
    return seatIdToSessionKeyRef.current.get(seatId);
  }, []);

  const loadSessionChat = useCallback(async (sessionKey: string): Promise<ChatMessage[]> => {
    const client = clientRef.current;
    if (!client || client.status !== "connected") return [];
    try {
      return await loadSessionPreview(client, sessionKey);
    } catch (err) {
      console.error("[Store] loadSessionChat failed:", err);
      return [];
    }
  }, []);

  useEffect(() => {
    return gameEvents.on("new-session-for-seat", (seatId) => {
      newSessionForSeat(seatId);
      gameEvents.emit("open-terminal", seatId);
    });
  }, [newSessionForSeat]);

  return React.createElement(
    StudioContext.Provider,
    {
      value: {
        state,
        connect,
        disconnect,
        assignTask,
        updateSeatConfig,
        newSession,
        switchSession,
        prepareSessionForSeat,
        newSessionForSeat,
        getBoundSessionForSeat,
        loadSessionChat,
      },
    },
    children,
  );
}

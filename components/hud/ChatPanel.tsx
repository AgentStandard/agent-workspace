"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { useStudio } from "@/lib/store";
import { gameEvents } from "@/lib/events";
import type { ChatMessage, SessionRecord, TaskItem } from "@/types/game";
import { findTask } from "@/lib/reducer";
import HudFlyout from "./HudFlyout";
import MessageBubble from "./MessageBubble";
import SessionSwitcher from "./SessionSwitcher";

export default function ChatPanel({
  messages,
  tasks,
  isConnected,
  sessions,
  activeSessionKey,
}: {
  messages: ChatMessage[];
  tasks: TaskItem[];
  isConnected: boolean;
  sessions: SessionRecord[];
  activeSessionKey?: string;
}) {
  const { assignTask } = useStudio();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const actorByRunId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (!task.actorName) continue;
      if (task.runId) map.set(task.runId, task.actorName);
      map.set(task.taskId, task.actorName);
    }
    return map;
  }, [tasks]);

  const stopHandler = useCallback((runId: string, seatId: string) => {
    gameEvents.emit("stop-task", runId, seatId);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !isConnected) return;
    assignTask(trimmed);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <HudFlyout
      title="Chat"
      subtitle={isConnected ? "Send messages and view execution" : "Connect to start"}
      headerAction={
        <SessionSwitcher sessions={sessions} activeKey={activeSessionKey} />
      }
      bodyClass="hud-flyout__body--chat"
    >
      <div className="hud-chat-layout">
        <div ref={scrollRef} className="hud-chat">
          {messages.length === 0 ? (
            <div className="hud-empty">No conversation yet. Type a message to begin.</div>
          ) : (
            messages.map((message) => {
              const task = findTask(tasks, message.runId);
              const canStop = task?.status === "running" && (task.runId ?? task.taskId);
              return (
                <MessageBubble
                  key={message.id}
                  msg={message}
                  actorName={actorByRunId.get(message.runId)}
                  canStop={!!canStop}
                  onStop={canStop ? () => stopHandler(task.runId ?? task.taskId, task.seatId ?? "") : undefined}
                />
              );
            })
          )}
        </div>

        <div className="hud-chat-input-row">
          <textarea
            ref={inputRef}
            className="pixel-input"
            style={{ flex: 1, minHeight: 40, height: 40, resize: "none", padding: "8px 10px" }}
            placeholder={isConnected ? "Type a message..." : "Connect first..."}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
          />
          <button
            type="button"
            className="pixel-icon-btn pixel-icon-btn--primary"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40 }}
            onClick={handleSend}
            disabled={!isConnected || !input.trim()}
            title="Send"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </HudFlyout>
  );
}

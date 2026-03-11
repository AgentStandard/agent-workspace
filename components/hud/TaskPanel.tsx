"use client";

import type { TaskItem } from "@/types/game";
import { formatRelativeTime } from "@/lib/constants";
import HudFlyout from "./HudFlyout";

function taskStatusLabel(status: TaskItem["status"]) {
  switch (status) {
    case "queued":
      return "queued";
    case "returning":
      return "returning";
    case "submitted":
      return "sending";
    case "stopped":
      return "stopped";
    default:
      return status;
  }
}

export default function TaskPanel({ tasks }: { tasks: TaskItem[] }) {
  const runningTasks = tasks.filter((task) =>
    ["running", "submitted", "queued", "returning"].includes(task.status)
  );

  return (
    <HudFlyout title="Tasks" subtitle={`${runningTasks.length} active / ${tasks.length} total`}>
      <div className="hud-list">
        {tasks.length === 0 ? (
          <div className="hud-empty">No tasks yet.</div>
        ) : (
          tasks.map((task) => (
            <div key={task.taskId} className="hud-list__item">
              <div className="hud-list__top">
                <span className={`hud-status hud-status--${task.status}`}>{taskStatusLabel(task.status)}</span>
                <span>{formatRelativeTime(task.completedAt ?? task.createdAt)}</span>
              </div>
              <div className="hud-list__title">{task.message}</div>
            </div>
          ))
        )}
      </div>
    </HudFlyout>
  );
}

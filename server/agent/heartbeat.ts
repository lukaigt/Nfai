import { storage } from "../storage";
import { executeTask } from "./core";

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let sendTelegramMessage: ((chatId: string, text: string) => Promise<void>) | null = null;
const runningScheduled = new Set<number>();

export function setSendFunction(fn: (chatId: string, text: string) => Promise<void>) {
  sendTelegramMessage = fn;
}

export function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(async () => {
    try {
      await checkAndRunDueTasks();
    } catch (err: any) {
      console.error("[Heartbeat] Error:", err.message);
    }
  }, 60000);
  console.log("[Heartbeat] Started — checking every 60 seconds");
}

export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log("[Heartbeat] Stopped");
  }
}

async function checkAndRunDueTasks() {
  const due = await storage.getDueScheduledTasks();
  for (const scheduled of due) {
    if (runningScheduled.has(scheduled.id)) continue;

    const now = new Date();
    const hour = now.getHours();
    if (scheduled.activeStartHour !== null && scheduled.activeEndHour !== null) {
      if (scheduled.activeStartHour <= scheduled.activeEndHour) {
        if (hour < scheduled.activeStartHour || hour >= scheduled.activeEndHour) continue;
      } else {
        if (hour < scheduled.activeStartHour && hour >= scheduled.activeEndHour) continue;
      }
    }

    const interval = Math.max(1, scheduled.intervalMinutes || 15);
    const nextRun = new Date(now.getTime() + interval * 60000);
    await storage.updateScheduledTask(scheduled.id, {
      lastRunAt: now,
      nextRunAt: nextRun,
    });

    runningScheduled.add(scheduled.id);

    (async () => {
      try {
        const task = await storage.createTask({
          title: `[Scheduled] ${scheduled.description.substring(0, 60)}`,
          description: scheduled.description,
          priority: 1,
          maxRetries: 2,
          telegramChatId: scheduled.telegramChatId,
          result: null,
          error: null,
        });

        await executeTask(task, async () => {});

        const completed = await storage.getTask(task.id);
        if (completed && sendTelegramMessage) {
          const result = completed.status === "completed"
            ? completed.result || "Done"
            : `Failed: ${completed.error || "Unknown error"}`;

          if (result !== scheduled.lastResult) {
            await sendTelegramMessage(
              scheduled.telegramChatId,
              `[Scheduled] ${scheduled.description.substring(0, 60)}\n\n${result.substring(0, 3000)}`
            );
            await storage.updateScheduledTask(scheduled.id, { lastResult: result.substring(0, 1000) });
          }
        }
      } catch (err: any) {
        console.error(`[Heartbeat] Failed scheduled #${scheduled.id}:`, err.message);
      } finally {
        runningScheduled.delete(scheduled.id);
      }
    })();
  }
}

import { storage } from "./storage";
import { executeTask, cancelTask, isTaskRunning } from "./agent/core";
import { testConnection } from "./agent/openrouter";

let bot: any = null;
let TelegramBot: any = null;

async function loadTelegramBot() {
  if (!TelegramBot) {
    try {
      TelegramBot = (await import("node-telegram-bot-api")).default;
    } catch {
      console.log("[Telegram] node-telegram-bot-api not available. Install it for Telegram support.");
      return null;
    }
  }
  return TelegramBot;
}

export async function startTelegramBot(): Promise<boolean> {
  const tokenSetting = await storage.getSetting("telegram_bot_token");
  const token = tokenSetting?.value || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log("[Telegram] No bot token configured. Set it in dashboard settings or TELEGRAM_BOT_TOKEN env var.");
    return false;
  }

  const BotClass = await loadTelegramBot();
  if (!BotClass) return false;

  try {
    if (bot) {
      try { bot.stopPolling(); } catch {}
    }

    bot = new BotClass(token, { polling: true });

    bot.on("message", async (msg: any) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text || "";

      const allowedSetting = await storage.getSetting("telegram_allowed_users");
      if (allowedSetting?.value) {
        const allowed = allowedSetting.value.split(",").map((s: string) => s.trim());
        if (!allowed.includes(chatId) && !allowed.includes(msg.from?.username || "")) {
          await bot.sendMessage(chatId, "Unauthorized. Your chat ID: " + chatId);
          return;
        }
      }

      if (text === "/start") {
        await bot.sendMessage(chatId, [
          "*Autonomous Agent Ready*",
          "",
          "Commands:",
          "/task <description> - Create and execute a task",
          "/status - View running tasks",
          "/cancel <id> - Cancel a running task",
          "/list - List recent tasks",
          "/test - Test AI connection",
          "/id - Get your chat ID",
          "",
          "Or just send a message to create a task.",
        ].join("\n"), { parse_mode: "Markdown" });
        return;
      }

      if (text === "/id") {
        await bot.sendMessage(chatId, `Your chat ID: \`${chatId}\``, { parse_mode: "Markdown" });
        return;
      }

      if (text === "/test") {
        await bot.sendMessage(chatId, "Testing AI connection...");
        const result = await testConnection();
        if (result.success) {
          await bot.sendMessage(chatId, `Connected to: ${result.model}`);
        } else {
          await bot.sendMessage(chatId, `Connection failed: ${result.error}`);
        }
        return;
      }

      if (text === "/status") {
        const tasks = await storage.getAllTasks();
        const running = tasks.filter(t => t.status === "running");
        if (running.length === 0) {
          await bot.sendMessage(chatId, "No tasks currently running.");
        } else {
          const lines = running.map(t => `#${t.id}: ${t.title} (${t.totalTokens} tokens, $${t.totalCostUsd})`);
          await bot.sendMessage(chatId, "*Running Tasks:*\n" + lines.join("\n"), { parse_mode: "Markdown" });
        }
        return;
      }

      if (text === "/list") {
        const tasks = await storage.getAllTasks();
        const recent = tasks.slice(0, 10);
        if (recent.length === 0) {
          await bot.sendMessage(chatId, "No tasks yet.");
        } else {
          const lines = recent.map(t => {
            const icon = t.status === "completed" ? "done" : t.status === "failed" ? "FAIL" : t.status === "running" ? "RUN" : "WAIT";
            return `[${icon}] #${t.id}: ${t.title.substring(0, 40)}`;
          });
          await bot.sendMessage(chatId, "*Recent Tasks:*\n```\n" + lines.join("\n") + "\n```", { parse_mode: "Markdown" });
        }
        return;
      }

      if (text.startsWith("/cancel")) {
        const idStr = text.replace("/cancel", "").trim();
        const id = parseInt(idStr);
        if (!id) {
          await bot.sendMessage(chatId, "Usage: /cancel <task_id>");
          return;
        }
        cancelTask(id);
        await bot.sendMessage(chatId, `Cancelling task #${id}...`);
        return;
      }

      if (!text.startsWith("/task")) {
        await bot.sendMessage(chatId, "Send me a task with:\n/task <description>\n\nExample: /task Find the top 5 trending GitHub repos today");
        return;
      }

      const taskDescription = text.replace("/task", "").trim();
      if (!taskDescription) {
        await bot.sendMessage(chatId, "Please describe the task.\n\nExample: /task Search for cheap VPS providers and compare prices");
        return;
      }

      const task = await storage.createTask({
        title: taskDescription.substring(0, 80),
        description: taskDescription,
        priority: 1,
        maxRetries: 5,
        telegramChatId: chatId,
        result: null,
        error: null,
      });

      await bot.sendMessage(chatId, `Task #${task.id} created: ${task.title}\nExecuting...`);

      executeTask(task, async (taskId, step, message, status) => {
        try {
          if (step % 3 === 0 || status === "completed" || status === "failure") {
            const truncated = message.substring(0, 300);
            await bot.sendMessage(chatId, `[Step ${step}] ${truncated}`);
          }
        } catch {}
      }).then(async () => {
        const completed = await storage.getTask(task.id);
        if (completed) {
          const statusMsg = completed.status === "completed"
            ? `Task #${task.id} completed!\n\n${(completed.result || "").substring(0, 3000)}\n\nTokens: ${completed.totalTokens} | Cost: $${completed.totalCostUsd}`
            : `Task #${task.id} ${completed.status}: ${(completed.error || "Unknown error").substring(0, 500)}`;
          try { await bot.sendMessage(chatId, statusMsg); } catch {}
        }
      });
    });

    bot.on("polling_error", (error: any) => {
      console.error("[Telegram] Polling error:", error.message);
    });

    console.log("[Telegram] Bot started successfully");
    return true;
  } catch (error: any) {
    console.error("[Telegram] Failed to start bot:", error.message);
    return false;
  }
}

export async function stopTelegramBot(): Promise<void> {
  if (bot) {
    try { bot.stopPolling(); } catch {}
    bot = null;
  }
}

export function isBotRunning(): boolean {
  return bot !== null;
}

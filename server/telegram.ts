import { storage } from "./storage";
import { executeTask, cancelTask, isTaskRunning } from "./agent/core";
import { testConnection, chatCompletion } from "./agent/openrouter";

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

async function classifyMessage(text: string): Promise<{ isTask: boolean; reply?: string }> {
  try {
    const result = await chatCompletion([
      {
        role: "system",
        content: `You are an autonomous AI agent running on the user's VPS server. You are NOT a generic chatbot - you are their personal agent deployed on their infrastructure.

Your capabilities:
- Execute code on the server (Node.js)
- Scrape websites and fetch web data
- Automate browsers with Puppeteer
- Make HTTP requests to any API
- Read/write files on the server
- Install packages
- Use stored credentials for platforms
- Search the web

Your job: Determine if the user's message is:
1. Casual/conversational (greeting, question about you/your capabilities, thanks, chat) → respond as their agent, briefly and naturally. Never say "I'm DeepSeek" or "I'm an AI assistant" - you are their autonomous agent.
2. An actionable task (requires tools, research, automation, scraping, coding, web actions) → mark as task

Respond with JSON only:
- For casual/chat: {"isTask": false, "reply": "your response as their agent"}
- For actionable task: {"isTask": true}`
      },
      { role: "user", content: text }
    ], 0.3);

    const cleaned = result.content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { isTask: !!parsed.isTask, reply: parsed.reply };
  } catch {
    if (text.length < 15 && !/\b(find|search|create|make|build|get|scrape|download|check|monitor|post|send|write|install|run|deploy|automate|hack|buy|sell|register|sign.?up|log.?in)\b/i.test(text)) {
      return { isTask: false, reply: "Hey! Send me a task and I'll execute it. For example: 'Find the top trending repos on GitHub today'" };
    }
    return { isTask: true };
  }
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
          "Just send me a message and I'll figure out what to do:",
          "- Chat naturally and I'll respond",
          "- Ask me to do something and I'll execute it as a task",
          "",
          "Commands:",
          "/task <description> - Force execute as task",
          "/status - View running tasks",
          "/cancel <id> - Cancel a running task",
          "/list - List recent tasks",
          "/test - Test AI connection",
          "/id - Get your chat ID",
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

      let taskDescription: string;

      if (text.startsWith("/task")) {
        taskDescription = text.replace("/task", "").trim();
        if (!taskDescription) {
          await bot.sendMessage(chatId, "Usage: /task <description>");
          return;
        }
      } else {
        const classification = await classifyMessage(text);
        if (!classification.isTask) {
          await bot.sendMessage(chatId, classification.reply || "Hey! What can I help you with?");
          return;
        }
        taskDescription = text;
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

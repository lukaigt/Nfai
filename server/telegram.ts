import { storage } from "./storage";
import { executeTask, cancelTask, isTaskRunning } from "./agent/core";
import { testConnection, chatCompletion } from "./agent/openrouter";
import { searchMemory, getAllMemoryText, clearAllMemory, saveMemory } from "./agent/memory";
import { startHeartbeat, setSendFunction } from "./agent/heartbeat";
import { loadSession, appendMessage, clearSession, getSessionMessages, getConversationContext } from "./agent/session";

let bot: any = null;
let TelegramBot: any = null;

const pendingPlans = new Map<string, string>();

const CHAT_SYSTEM_PROMPT = `You are an autonomous AI agent running on the user's VPS server. You are their personal agent with real power — a person sitting at a powerful computer who figures things out.

You have full conversation history and long-term memory. Use them.

Your real capabilities:
- Run ANY shell command (bash, python, curl, system admin, cron)
- Log in to ANY website using stored credentials (username+password via web login, NOT API keys)
- Scrape websites, search the web, make HTTP requests
- Read/write files, install packages, build apps
- Schedule recurring tasks

CRITICAL RULES:
1. NEVER say "I'm DeepSeek" or "I'm an AI assistant"
2. NEVER say "I can look that up if you'd like" — for questions, just look it up (execute). For complex tasks, propose a plan then execute on confirmation
3. NEVER say "I need API credentials/keys/client_id" — you have login credentials, you log in via web like a person
4. NEVER ask for things you can figure out yourself — search the web if you don't know how
5. For ANY factual, current, or time-sensitive question → use action "execute" to search the web
6. Think independently — figure out HOW to do things yourself
7. When user mentions a platform they have accounts on → your plan should use WEB LOGIN with Python requests, NOT API keys
8. Remember context — if user mentioned credentials or preferences, USE that info
9. When proposing plans for website interaction → always use: get credentials, write Python script with requests.Session(), log in, use cookies

How to respond — return ONLY a JSON object:

For casual chat (greetings, thanks, simple capability questions):
{"reply": "your response", "action": "chat"}

For factual/lookup questions (who's president, what's the price, latest news):
{"reply": "Let me find out.", "action": "execute", "taskDescription": "Search the web for: [question]"}

For requests that need planning (build something, interact with a platform, scrape a site):
{"reply": "Here's my plan:\\n1. Step one\\n2. Step two\\n3. Step three\\n\\nShould I go ahead?", "action": "propose", "taskDescription": "detailed description including: get credentials, log in via web with Python requests, perform actions with session cookies"}

For scheduling requests ("every 15 minutes", "daily", "hourly"):
{"reply": "I'll set that up as a recurring task.", "action": "schedule", "taskDescription": "what to do each time", "intervalMinutes": 15}

For things the user wants you to remember:
{"reply": "Got it, I'll remember that.", "action": "remember", "memoryContent": "what to remember", "memoryTags": "relevant,tags"}

ALWAYS respond with valid JSON. Nothing else.`;

async function getAgentResponse(chatId: string, userMessage: string): Promise<any> {
  const history = await loadSession(chatId);
  const memory = await searchMemory(userMessage);

  const systemContent = CHAT_SYSTEM_PROMPT
    + (memory ? `\n\nRELEVANT MEMORIES:\n${memory}` : "")
    + (pendingPlans.has(chatId) ? `\n\nYou previously proposed this plan and are waiting for confirmation: "${pendingPlans.get(chatId)}"` : "");

  type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    const result = await chatCompletion(messages, 0.5);
    const cleaned = result.content.replace(/```json\n?|\n?```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in AI response: " + cleaned.substring(0, 200));
    return JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    console.error("[Telegram] getAgentResponse error:", err.message || err);
    return { reply: "Something went wrong. Try again or use /task to force a task.", action: "chat" };
  }
}

async function loadTelegramBot() {
  if (!TelegramBot) {
    try {
      TelegramBot = (await import("node-telegram-bot-api")).default;
    } catch (err: any) {
      console.error("[Telegram] node-telegram-bot-api not available:", err.message || err);
      return null;
    }
  }
  return TelegramBot;
}

async function sendMsg(chatId: string, text: string) {
  if (bot) {
    const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
    for (const chunk of chunks) {
      try {
        await bot.sendMessage(chatId, chunk);
      } catch (err: any) {
        console.error("[Telegram] sendMsg error:", err.message || err);
      }
    }
  }
}

export async function startTelegramBot(): Promise<boolean> {
  const tokenSetting = await storage.getSetting("telegram_bot_token");
  const token = tokenSetting?.value || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log("[Telegram] No bot token configured.");
    return false;
  }

  const BotClass = await loadTelegramBot();
  if (!BotClass) return false;

  try {
    if (bot) {
      try { bot.stopPolling(); } catch (err: any) {
        console.error("[Telegram] stopPolling (pre-start) error:", err.message || err);
      }
    }

    bot = new BotClass(token, { polling: true });

    setSendFunction(sendMsg);
    startHeartbeat();

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
          "Your Autonomous Agent",
          "",
          "Talk to me naturally:",
          "- Ask anything and I'll answer or look it up",
          "- Tell me to do something → I'll propose a plan first",
          "- Say 'yes' to approve, 'no' to cancel",
          "",
          "Commands:",
          "/task <desc> - Execute immediately (skip planning)",
          "/status - Running tasks",
          "/cancel <id> - Cancel a task",
          "/list - Recent tasks",
          "/test - Test AI connection",
          "/id - Your chat ID",
          "/reset - Clear conversation",
          "/memory - View memories",
          "/forget - Wipe all memory",
          "/remember <text> - Save a note",
          "/schedules - View recurring tasks",
          "/unschedule <id> - Remove recurring task",
        ].join("\n"));
        return;
      }

      if (text === "/id") {
        await bot.sendMessage(chatId, `Your chat ID: ${chatId}`);
        return;
      }

      if (text === "/test") {
        await bot.sendMessage(chatId, "Testing AI connection...");
        const result = await testConnection();
        await bot.sendMessage(chatId, result.success ? `Connected: ${result.model}` : `Failed: ${result.error}`);
        return;
      }

      if (text === "/status") {
        const tasks = await storage.getAllTasks();
        const running = tasks.filter(t => t.status === "running");
        if (running.length === 0) {
          await bot.sendMessage(chatId, "No tasks running.");
        } else {
          const lines = running.map(t => `#${t.id}: ${t.title} (${t.totalTokens} tokens, $${t.totalCostUsd})`);
          await bot.sendMessage(chatId, "Running:\n" + lines.join("\n"));
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
            const icon = t.status === "completed" ? "DONE" : t.status === "failed" ? "FAIL" : t.status === "running" ? "RUN" : "WAIT";
            return `[${icon}] #${t.id}: ${t.title.substring(0, 50)}`;
          });
          await bot.sendMessage(chatId, "Recent:\n" + lines.join("\n"));
        }
        return;
      }

      if (text.startsWith("/cancel")) {
        const id = parseInt(text.replace("/cancel", "").trim());
        if (!id) { await bot.sendMessage(chatId, "Usage: /cancel <id>"); return; }
        cancelTask(id);
        await bot.sendMessage(chatId, `Cancelling #${id}...`);
        return;
      }

      if (text === "/reset") {
        const tasks = await storage.getAllTasks();
        const totalTokens = tasks.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
        const totalCost = tasks.reduce((sum, t) => sum + parseFloat(t.totalCostUsd || "0"), 0);
        await clearSession(chatId);
        pendingPlans.delete(chatId);
        await bot.sendMessage(chatId, `Conversation cleared.\nTokens: ${totalTokens.toLocaleString()} | Cost: $${totalCost.toFixed(4)}\nMemory preserved. /forget to wipe.`);
        return;
      }

      if (text === "/memory") {
        const memory = await getAllMemoryText();
        if (!memory) {
          await bot.sendMessage(chatId, "No memories yet.");
        } else {
          await sendMsg(chatId, `Memories:\n\n${memory.substring(0, 3500)}`);
        }
        return;
      }

      if (text === "/forget") {
        await clearAllMemory();
        await clearSession(chatId);
        pendingPlans.delete(chatId);
        await bot.sendMessage(chatId, "Memory and conversation wiped. Fresh start.");
        return;
      }

      if (text.startsWith("/remember")) {
        const note = text.replace("/remember", "").trim();
        if (!note) { await bot.sendMessage(chatId, "Usage: /remember <text>"); return; }
        await saveMemory(note, "user-note", "user");
        await bot.sendMessage(chatId, "Noted.");
        return;
      }

      if (text === "/schedules") {
        const scheduled = await storage.getAllScheduledTasks();
        const active = scheduled.filter(s => s.isActive);
        if (active.length === 0) {
          await bot.sendMessage(chatId, "No scheduled tasks. Ask me to do something regularly and I'll set it up.");
        } else {
          const lines = active.map(s => {
            const next = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "N/A";
            return `#${s.id}: ${s.description.substring(0, 50)} (every ${s.intervalMinutes}min, next: ${next})`;
          });
          await bot.sendMessage(chatId, "Scheduled:\n" + lines.join("\n"));
        }
        return;
      }

      if (text.startsWith("/unschedule")) {
        const id = parseInt(text.replace("/unschedule", "").trim());
        if (!id) { await bot.sendMessage(chatId, "Usage: /unschedule <id>"); return; }
        await storage.deleteScheduledTask(id);
        await bot.sendMessage(chatId, `Removed scheduled task #${id}.`);
        return;
      }

      if (text.startsWith("/task")) {
        const taskDescription = text.replace("/task", "").trim();
        if (!taskDescription) { await bot.sendMessage(chatId, "Usage: /task <description>"); return; }
        await appendMessage(chatId, "user", `/task ${taskDescription}`);
        pendingPlans.delete(chatId);
        const context = getConversationContext(chatId);
        await createAndExecuteTask(chatId, taskDescription, context);
        return;
      }

      await appendMessage(chatId, "user", text);

      const confirmWords = /^(yes|yeah|yep|yea|sure|ok|okay|go|go ahead|do it|proceed|let's go|lets go|absolutely|confirmed|approve|start|run it)$/i;
      const cancelWords = /^(no|nah|nope|cancel|stop|nevermind|never mind|forget it|don't|dont)$/i;
      const trimmedText = text.trim();

      if (confirmWords.test(trimmedText) && pendingPlans.has(chatId)) {
        const planDesc = pendingPlans.get(chatId)!;
        pendingPlans.delete(chatId);
        await appendMessage(chatId, "assistant", "On it.");
        await bot.sendMessage(chatId, "On it.");
        const context = getConversationContext(chatId);
        await createAndExecuteTask(chatId, planDesc, context);
        return;
      }

      if (cancelWords.test(trimmedText) && pendingPlans.has(chatId)) {
        pendingPlans.delete(chatId);
        await appendMessage(chatId, "assistant", "Cancelled. What else?");
        await bot.sendMessage(chatId, "Cancelled. What else?");
        return;
      }

      if (!confirmWords.test(trimmedText) && !cancelWords.test(trimmedText)) {
        pendingPlans.delete(chatId);
      }

      const response = await getAgentResponse(chatId, text);

      const validActions = ["chat", "propose", "execute", "confirm", "schedule", "remember"];
      const action = validActions.includes(response.action) ? response.action : "chat";

      if (action === "remember" && response.memoryContent) {
        await saveMemory(response.memoryContent, response.memoryTags || "user-info", "user");
        await appendMessage(chatId, "assistant", response.reply);
        await bot.sendMessage(chatId, response.reply);
        return;
      }

      if (action === "schedule" && response.taskDescription && response.intervalMinutes) {
        const interval = Math.max(1, Math.min(response.intervalMinutes, 1440));
        const nextRun = new Date(Date.now() + interval * 60000);
        await storage.createScheduledTask({
          description: response.taskDescription,
          intervalMinutes: interval,
          telegramChatId: chatId,
          nextRunAt: nextRun,
          activeStartHour: null,
          activeEndHour: null,
        });
        await appendMessage(chatId, "assistant", response.reply);
        await bot.sendMessage(chatId, response.reply);
        return;
      }

      if (action === "propose" && response.taskDescription) {
        pendingPlans.set(chatId, response.taskDescription);
        await appendMessage(chatId, "assistant", response.reply);
        await bot.sendMessage(chatId, response.reply);
        return;
      }

      if (action === "execute" && response.taskDescription) {
        await appendMessage(chatId, "assistant", response.reply);
        await bot.sendMessage(chatId, response.reply);
        const context = getConversationContext(chatId);
        await createAndExecuteTask(chatId, response.taskDescription, context);
        return;
      }

      if (action === "confirm") {
        await appendMessage(chatId, "assistant", "What would you like me to do?");
        await bot.sendMessage(chatId, "What would you like me to do?");
        return;
      }

      await appendMessage(chatId, "assistant", response.reply);
      await bot.sendMessage(chatId, response.reply);
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

async function createAndExecuteTask(chatId: string, description: string, conversationContext?: string) {
  const task = await storage.createTask({
    title: description.substring(0, 80),
    description: conversationContext
      ? `${description}\n\n--- CONVERSATION CONTEXT ---\n${conversationContext}`
      : description,
    priority: 1,
    maxRetries: 5,
    telegramChatId: chatId,
    result: null,
    error: null,
  });

  await bot.sendMessage(chatId, `Task #${task.id} started: ${task.title}`);

  executeTask(task, async (taskId, step, message, status) => {
    try {
      if (step % 3 === 0 || status === "completed" || status === "failure") {
        const truncated = message.substring(0, 300);
        await bot.sendMessage(chatId, `[Step ${step}] ${truncated}`);
      }
    } catch (err: any) {
      console.error("[Telegram] Task step callback error:", err.message || err);
    }
  }).then(async () => {
    const completed = await storage.getTask(task.id);
    if (completed) {
      const statusMsg = completed.status === "completed"
        ? `Task #${task.id} done!\n\n${(completed.result || "").substring(0, 3000)}\n\nTokens: ${completed.totalTokens} | Cost: $${completed.totalCostUsd}`
        : `Task #${task.id} ${completed.status}: ${(completed.error || "Unknown error").substring(0, 500)}`;
      try {
        await sendMsg(chatId, statusMsg);
        await appendMessage(chatId, "assistant", `[Task result] ${(completed.result || completed.error || "").substring(0, 500)}`);
      } catch (err: any) {
        console.error("[Telegram] Task completion message error:", err.message || err);
      }
    }
  });
}

export async function stopTelegramBot(): Promise<void> {
  if (bot) {
    try { bot.stopPolling(); } catch (err: any) {
      console.error("[Telegram] stopPolling error:", err.message || err);
    }
    bot = null;
  }
}

export function isBotRunning(): boolean {
  return bot !== null;
}

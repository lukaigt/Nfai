import { storage } from "./storage";
import { executeTask, cancelTask, isTaskRunning, readMemory, clearMemory } from "./agent/core";
import { testConnection, chatCompletion } from "./agent/openrouter";

let bot: any = null;
let TelegramBot: any = null;

const chatHistories = new Map<string, { role: "system" | "user" | "assistant"; content: string }[]>();
const pendingPlans = new Map<string, string>();
const MAX_HISTORY = 20;

function getChatHistory(chatId: string): { role: "system" | "user" | "assistant"; content: string }[] {
  if (!chatHistories.has(chatId)) {
    chatHistories.set(chatId, []);
  }
  return chatHistories.get(chatId)!;
}

function addToHistory(chatId: string, role: "user" | "assistant", content: string) {
  const history = getChatHistory(chatId);
  history.push({ role, content });
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function clearChatHistory(chatId: string) {
  chatHistories.set(chatId, []);
  pendingPlans.delete(chatId);
}

const CHAT_SYSTEM_PROMPT = `You are an autonomous AI agent running on the user's VPS server. You are NOT a generic chatbot - you are their personal agent with real power.

Your capabilities (you can actually do these, not just talk about them):
- Run ANY shell command on the server (bash, python, system admin)
- Scrape websites and fetch web data
- Automate browsers with Puppeteer
- Make HTTP requests to any API
- Read/write files on the server
- Install packages
- Use stored credentials for platforms
- Search the web

IMPORTANT RULES:
1. NEVER say "I'm DeepSeek" or "I'm an AI assistant" - you are the user's autonomous agent
2. NEVER say "I can look that up if you'd like" - just DO it or propose a plan
3. Your training data may be outdated - for ANY factual, current, or time-sensitive question, use action "execute" to search the web
4. Be direct and confident - you have real power on this server

How to respond - return ONLY a JSON object:

For casual chat (greetings, thanks, questions about your capabilities):
{"reply": "your natural response", "action": "chat"}

For factual/current questions (who's president, what's the price of X, latest news, etc.):
{"reply": "Let me look that up for you.", "action": "execute", "taskDescription": "Search the web for: [the question]"}

For big/complex requests that need a plan first:
{"reply": "Here's what I'll do:\\n1. First step\\n2. Second step\\n3. Third step\\n\\nShould I go ahead?", "action": "propose", "taskDescription": "detailed description of what to execute"}

When user confirms a previously proposed plan (they say "yes", "do it", "go", "go ahead", "sure", "ok"):
{"reply": "On it.", "action": "confirm"}

If user says "yes" but there's nothing to confirm, just ask what they need:
{"reply": "What would you like me to do?", "action": "chat"}

ALWAYS respond with valid JSON. Nothing else.`;

async function getAgentResponse(chatId: string, userMessage: string): Promise<{ reply: string; action: string; taskDescription?: string }> {
  const history = getChatHistory(chatId);
  const memory = await readMemory();

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT + (memory ? `\n\nYour memory of past tasks:\n${memory}` : "") + (pendingPlans.has(chatId) ? `\n\nYou previously proposed this plan: "${pendingPlans.get(chatId)}"` : "") },
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    const result = await chatCompletion(messages, 0.5);
    const cleaned = result.content.replace(/```json\n?|\n?```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { reply: "Something went wrong with my response. Try again or use /task to force a task.", action: "chat" };
  }
}

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
          "*Your Autonomous Agent*",
          "",
          "Just talk to me naturally:",
          "- Ask me anything and I'll answer or look it up",
          "- Tell me to do something and I'll propose a plan first",
          "- Say \"yes\" or \"go ahead\" to approve a plan",
          "",
          "Commands:",
          "/task <description> - Execute immediately (skip planning)",
          "/status - View running tasks",
          "/cancel <id> - Cancel a running task",
          "/list - List recent tasks",
          "/test - Test AI connection",
          "/id - Get your chat ID",
          "/reset - Clear conversation history",
          "/memory - View what I remember",
          "/forget - Wipe my memory",
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

      if (text === "/reset") {
        const tasks = await storage.getAllTasks();
        const totalTokens = tasks.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
        const totalCost = tasks.reduce((sum, t) => sum + parseFloat(t.totalCostUsd || "0"), 0);
        clearChatHistory(chatId);
        await bot.sendMessage(chatId, `Conversation cleared.\n\nTotal tokens used: ${totalTokens.toLocaleString()}\nTotal cost: $${totalCost.toFixed(4)}\n\nMemory preserved. Use /forget to wipe memory too.`);
        return;
      }

      if (text === "/memory") {
        const memory = await readMemory();
        if (!memory) {
          await bot.sendMessage(chatId, "No memories yet. I'll remember things as I complete tasks.");
        } else {
          await bot.sendMessage(chatId, `*Agent Memory:*\n\`\`\`\n${memory.substring(0, 3500)}\n\`\`\``, { parse_mode: "Markdown" });
        }
        return;
      }

      if (text === "/forget") {
        await clearMemory();
        clearChatHistory(chatId);
        await bot.sendMessage(chatId, "Memory and conversation wiped. Fresh start.");
        return;
      }

      if (text.startsWith("/task")) {
        const taskDescription = text.replace("/task", "").trim();
        if (!taskDescription) {
          await bot.sendMessage(chatId, "Usage: /task <description>");
          return;
        }
        addToHistory(chatId, "user", `/task ${taskDescription}`);
        pendingPlans.delete(chatId);
        await createAndExecuteTask(chatId, taskDescription);
        return;
      }

      addToHistory(chatId, "user", text);

      const confirmWords = /^(yes|yeah|yep|yea|sure|ok|okay|go|go ahead|do it|proceed|let's go|lets go|absolutely|confirmed|approve|start|run it)$/i;
      const cancelWords = /^(no|nah|nope|cancel|stop|nevermind|never mind|forget it|don't|dont)$/i;
      const trimmedText = text.trim();

      if (confirmWords.test(trimmedText) && pendingPlans.has(chatId)) {
        const planDesc = pendingPlans.get(chatId)!;
        pendingPlans.delete(chatId);
        addToHistory(chatId, "assistant", "On it.");
        await bot.sendMessage(chatId, "On it.");
        await createAndExecuteTask(chatId, planDesc);
        return;
      }

      if (cancelWords.test(trimmedText) && pendingPlans.has(chatId)) {
        pendingPlans.delete(chatId);
        addToHistory(chatId, "assistant", "Plan cancelled. What else do you need?");
        await bot.sendMessage(chatId, "Plan cancelled. What else do you need?");
        return;
      }

      if (!confirmWords.test(trimmedText) && !cancelWords.test(trimmedText)) {
        pendingPlans.delete(chatId);
      }

      const response = await getAgentResponse(chatId, text);

      const validActions = ["chat", "propose", "execute", "confirm"];
      const action = validActions.includes(response.action) ? response.action : "chat";

      if (action === "confirm") {
        addToHistory(chatId, "assistant", "What would you like me to do?");
        await bot.sendMessage(chatId, "What would you like me to do?");
        return;
      }

      if (action === "propose" && response.taskDescription) {
        pendingPlans.set(chatId, response.taskDescription);
        addToHistory(chatId, "assistant", response.reply);
        await bot.sendMessage(chatId, response.reply);
        return;
      }

      if (action === "execute" && response.taskDescription) {
        addToHistory(chatId, "assistant", response.reply);
        await bot.sendMessage(chatId, response.reply);
        await createAndExecuteTask(chatId, response.taskDescription);
        return;
      }

      if (action === "execute" && !response.taskDescription) {
        addToHistory(chatId, "assistant", response.reply || "Could you clarify what you'd like me to do?");
        await bot.sendMessage(chatId, response.reply || "Could you clarify what you'd like me to do?");
        return;
      }

      addToHistory(chatId, "assistant", response.reply);
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

async function createAndExecuteTask(chatId: string, description: string) {
  const task = await storage.createTask({
    title: description.substring(0, 80),
    description,
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
    } catch {}
  }).then(async () => {
    const completed = await storage.getTask(task.id);
    if (completed) {
      const statusMsg = completed.status === "completed"
        ? `Task #${task.id} done!\n\n${(completed.result || "").substring(0, 3000)}\n\nTokens: ${completed.totalTokens} | Cost: $${completed.totalCostUsd}`
        : `Task #${task.id} ${completed.status}: ${(completed.error || "Unknown error").substring(0, 500)}`;
      try {
        await bot.sendMessage(chatId, statusMsg);
        addToHistory(chatId, "assistant", `[Task completed] ${(completed.result || completed.error || "").substring(0, 300)}`);
      } catch {}
    }
  });
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

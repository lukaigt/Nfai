import fs from "fs/promises";
import path from "path";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(process.cwd(), "sessions");
const MAX_MEMORY = 50;

const sessionCache = new Map<string, ChatMessage[]>();

async function ensureDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function sessionPath(chatId: string): string {
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SESSIONS_DIR, `${safe}.jsonl`);
}

export async function loadSession(chatId: string): Promise<ChatMessage[]> {
  if (sessionCache.has(chatId)) return sessionCache.get(chatId)!;

  await ensureDir();
  const filePath = sessionPath(chatId);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const lines = data.trim().split("\n").filter(Boolean);
    const messages: ChatMessage[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch {}
    }
    const trimmed = messages.length > MAX_MEMORY ? messages.slice(-MAX_MEMORY) : messages;
    sessionCache.set(chatId, trimmed);
    return trimmed;
  } catch {
    sessionCache.set(chatId, []);
    return [];
  }
}

export async function appendMessage(chatId: string, role: "user" | "assistant", content: string): Promise<void> {
  await ensureDir();
  const messages = await loadSession(chatId);
  const msg: ChatMessage = { role, content };
  messages.push(msg);

  while (messages.length > MAX_MEMORY) {
    messages.shift();
  }

  sessionCache.set(chatId, messages);

  const filePath = sessionPath(chatId);
  await fs.appendFile(filePath, JSON.stringify(msg) + "\n");
}

export async function clearSession(chatId: string): Promise<void> {
  await ensureDir();
  sessionCache.set(chatId, []);

  const filePath = sessionPath(chatId);
  try {
    const ts = Date.now();
    const archivePath = path.join(SESSIONS_DIR, `${chatId}_archive_${ts}.jsonl`);
    await fs.rename(filePath, archivePath);
  } catch {}
}

export function getSessionMessages(chatId: string): ChatMessage[] {
  return sessionCache.get(chatId) || [];
}

export function getConversationContext(chatId: string, count: number = 10): string {
  const messages = getSessionMessages(chatId);
  if (messages.length === 0) return "";
  return messages.slice(-count).map(m => `[${m.role}]: ${m.content.substring(0, 300)}`).join("\n");
}

import { storage } from "../storage";
import crypto from "crypto";

export async function saveMemory(content: string, tags: string, source: string = "task"): Promise<void> {
  const hash = crypto.createHash("md5").update(content).digest("hex");
  const existing = await storage.getAllMemories();
  if (existing.some(m => m.hash === hash)) return;
  await storage.createMemory({ content, source, tags, hash });
}

export async function searchMemory(query: string): Promise<string> {
  const memories = await storage.searchMemories(query);
  if (memories.length === 0) return "";
  return memories.map(m => {
    const tags = m.tags ? ` [${m.tags}]` : "";
    const date = m.createdAt ? new Date(m.createdAt).toISOString().split("T")[0] : "";
    return `[${date}]${tags} ${m.content}`;
  }).join("\n\n");
}

export async function getAllMemoryText(): Promise<string> {
  const memories = await storage.getAllMemories();
  if (memories.length === 0) return "";
  return memories.map(m => {
    const tags = m.tags ? ` [${m.tags}]` : "";
    const date = m.createdAt ? new Date(m.createdAt).toISOString().split("T")[0] : "";
    return `[${date}]${tags} ${m.content}`;
  }).join("\n\n");
}

export async function clearAllMemory(): Promise<void> {
  await storage.clearMemories();
}

export async function saveTaskMemory(title: string, result: string, tokens: number, cost: string): Promise<void> {
  const summary = `Task: "${title}" — ${result.substring(0, 500)}`;
  const tags = "task,completed";
  await saveMemory(summary, tags, "task");
}

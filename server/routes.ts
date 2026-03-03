import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { executeTask, cancelTask, retryTask, isTaskRunning } from "./agent/core";
import { testConnection, getAvailableModels, chatCompletion } from "./agent/openrouter";
import { getAvailableTools } from "./agent/tools";
import { startTelegramBot, stopTelegramBot, isBotRunning } from "./telegram";
import { insertTaskSchema, insertCredentialSchema } from "@shared/schema";
import crypto from "crypto";
import { z } from "zod";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    console.warn("[Security] SESSION_SECRET is weak or missing. Set a strong secret for production.");
  }
  return crypto.scryptSync(secret || "dev-key-not-for-production", "agentcore-salt", 32);
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return iv.toString("hex") + ":" + authTag + ":" + encrypted;
}

function decrypt(text: string): string {
  const key = getEncryptionKey();
  const parts = text.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const createTaskBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000),
  priority: z.number().min(1).max(10).optional().default(1),
  maxRetries: z.number().min(0).max(20).optional().default(5),
  telegramChatId: z.string().optional().nullable(),
  execute: z.boolean().optional().default(true),
});

const createCredentialBody = z.object({
  platform: z.string().min(1).max(50),
  label: z.string().max(200).optional(),
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
  metadata: z.any().optional(),
});

const settingBody = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(0).max(5000),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getStats();
      const botStatus = isBotRunning();
      res.json({ ...stats, telegramConnected: botStatus });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getAllSettings();
      const safe = settings.map(s => ({
        ...s,
        value: s.key.includes("key") || s.key.includes("token") || s.key.includes("password")
          ? "***" + s.value.slice(-4)
          : s.value,
      }));
      res.json(safe);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const parsed = settingBody.parse(req.body);
      const setting = await storage.upsertSetting(parsed.key, parsed.value);
      res.json(setting);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/bulk", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "settings array required" });
      }
      const results = [];
      for (const item of settings) {
        const parsed = settingBody.parse(item);
        results.push(await storage.upsertSetting(parsed.key, parsed.value));
      }
      res.json(results);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/settings/:key", async (req, res) => {
    try {
      await storage.deleteSetting(req.params.key);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tasks", async (_req, res) => {
    try {
      const tasks = await storage.getAllTasks();
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });
      const task = await storage.getTask(id);
      if (!task) return res.status(404).json({ error: "Task not found" });
      const logs = await storage.getTaskLogs(task.id);
      res.json({ ...task, logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const parsed = createTaskBody.parse(req.body);
      const task = await storage.createTask({
        title: parsed.title || parsed.description.substring(0, 80),
        description: parsed.description,
        priority: parsed.priority,
        maxRetries: parsed.maxRetries,
        telegramChatId: parsed.telegramChatId || null,
        result: null,
        error: null,
      });

      if (parsed.execute) {
        executeTask(task).catch(err => console.error(`Task ${task.id} error:`, err));
      }

      res.status(201).json(task);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/tasks/:id/cancel", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });
      cancelTask(id);
      await storage.updateTask(id, { status: "paused" });
      res.json({ message: "Task cancellation requested" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/tasks/:id/retry", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });
      retryTask(id).catch(err => console.error(`Retry task ${id} error:`, err));
      res.json({ message: "Task retry started" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });
      await storage.deleteTask(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tasks/:id/logs", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });
      const logs = await storage.getTaskLogs(id);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/logs", async (_req, res) => {
    try {
      const logs = await storage.getAllLogs();
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/credentials", async (_req, res) => {
    try {
      const creds = await storage.getAllCredentials();
      const safe = creds.map(c => ({
        ...c,
        encryptedPassword: "***",
      }));
      res.json(safe);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/credentials", async (req, res) => {
    try {
      const parsed = createCredentialBody.parse(req.body);
      const cred = await storage.createCredential({
        platform: parsed.platform,
        label: parsed.label || `${parsed.platform} - ${parsed.username}`,
        username: parsed.username,
        encryptedPassword: encrypt(parsed.password),
        metadata: parsed.metadata ? JSON.stringify(parsed.metadata) : null,
      });
      res.status(201).json({ ...cred, encryptedPassword: "***" });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/credentials/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid credential ID" });
      const updates: any = {};
      if (req.body.platform) updates.platform = req.body.platform;
      if (req.body.label) updates.label = req.body.label;
      if (req.body.username) updates.username = req.body.username;
      if (req.body.password) updates.encryptedPassword = encrypt(req.body.password);
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      if (req.body.metadata) updates.metadata = JSON.stringify(req.body.metadata);

      const cred = await storage.updateCredential(id, updates);
      if (!cred) return res.status(404).json({ error: "Credential not found" });
      res.json({ ...cred, encryptedPassword: "***" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/credentials/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid credential ID" });
      await storage.deleteCredential(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/test", async (req, res) => {
    try {
      const { apiKey, baseUrl, model } = req.body || {};
      const result = await testConnection({ apiKey, baseUrl, model });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ai/models", async (_req, res) => {
    try {
      res.json(getAvailableModels());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ai/tools", async (_req, res) => {
    try {
      res.json(getAvailableTools());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/telegram/start", async (_req, res) => {
    try {
      const success = await startTelegramBot();
      res.json({ success, running: isBotRunning() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/telegram/stop", async (_req, res) => {
    try {
      await stopTelegramBot();
      res.json({ success: true, running: false });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/telegram/status", async (_req, res) => {
    res.json({ running: isBotRunning() });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") return res.status(400).json({ error: "message string required" });

      const result = await chatCompletion([
        { role: "system", content: "You are a helpful assistant. Answer briefly and clearly." },
        { role: "user", content: message.substring(0, 2000) },
      ]);

      res.json({ response: result.content, tokensUsed: result.tokensUsed, cost: result.cost });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  setTimeout(async () => {
    try {
      await startTelegramBot();
    } catch (e) {
      console.log("[Telegram] Auto-start skipped:", (e as any).message);
    }
  }, 3000);

  return httpServer;
}

import { storage } from "../storage";
import { saveMemory } from "./memory";
import https from "https";
import http from "http";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

type ToolHandler = (args: any) => Promise<ToolResult>;

const toolHandlers: Record<string, ToolHandler> = {
  async web_scrape(args: { url: string }): Promise<ToolResult> {
    try {
      const response = await fetchUrl(args.url);
      const text = response.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const truncated = text.substring(0, 8000);
      return { success: true, output: truncated };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async execute_code(args: { code: string; description: string }): Promise<ToolResult> {
    try {
      const tmpFile = path.join("/tmp", `agent_code_${Date.now()}.js`);
      await fs.writeFile(tmpFile, args.code);
      const { stdout, stderr } = await execAsync(`node ${tmpFile}`, { timeout: 30000 });
      await fs.unlink(tmpFile).catch(() => {});
      return { success: true, output: stdout + (stderr ? `\nSTDERR: ${stderr}` : "") };
    } catch (error: any) {
      return { success: false, output: error.stdout || "", error: error.message };
    }
  },

  async run_command(args: { command: string }): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execAsync(args.command, { timeout: 60000, maxBuffer: 1024 * 1024 });
      return { success: true, output: (stdout + (stderr ? `\nSTDERR: ${stderr}` : "")).substring(0, 10000) };
    } catch (error: any) {
      return { success: false, output: error.stdout || "", error: (error.message || "").substring(0, 3000) };
    }
  },

  async install_package(args: { packageName: string }): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execAsync(`npm install ${args.packageName}`, { timeout: 60000 });
      return { success: true, output: `Installed ${args.packageName}\n${stdout}` };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async file_write(args: { path: string; content: string }): Promise<ToolResult> {
    try {
      const dir = path.dirname(args.path);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(args.path, args.content);
      return { success: true, output: `Written to ${args.path}` };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async file_read(args: { path: string }): Promise<ToolResult> {
    try {
      const content = await fs.readFile(args.path, "utf-8");
      return { success: true, output: content.substring(0, 10000) };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async http_request(args: { method: string; url: string; headers?: any; body?: any }): Promise<ToolResult> {
    try {
      const response = await fetchUrl(args.url, {
        method: args.method,
        headers: args.headers,
        body: args.body ? JSON.stringify(args.body) : undefined,
      });
      return { success: true, output: response.substring(0, 8000) };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async get_credentials(args: { platform: string }): Promise<ToolResult> {
    try {
      const crypto = await import("crypto");
      const creds = await storage.getAllCredentials();
      const matching = creds.filter(c =>
        c.platform.toLowerCase() === args.platform.toLowerCase() && c.isActive
      );
      if (matching.length === 0) {
        return { success: false, output: "", error: `No credentials found for ${args.platform}` };
      }
      const result = matching.map(c => {
        let password = "[encrypted]";
        try {
          const secret = process.env.SESSION_SECRET || "dev-key-not-for-production";
          const key = crypto.scryptSync(secret, "agentcore-salt", 32);
          const parts = c.encryptedPassword.split(":");
          if (parts.length === 3) {
            const iv = Buffer.from(parts[0], "hex");
            const authTag = Buffer.from(parts[1], "hex");
            const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAuthTag(authTag);
            password = decipher.update(parts[2], "hex", "utf8") + decipher.final("utf8");
          }
        } catch {}
        return {
          id: c.id,
          label: c.label,
          username: c.username,
          password,
          metadata: c.metadata ? JSON.parse(c.metadata) : null,
        };
      });
      return { success: true, output: JSON.stringify(result) };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async search_web(args: { query: string }): Promise<ToolResult> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
      const html = await fetchUrl(url);
      const results: string[] = [];
      const linkRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)/g;
      let match;
      let count = 0;
      while ((match = linkRegex.exec(html)) !== null && count < 5) {
        results.push(`${match[2].trim()}: ${match[1]}`);
        count++;
      }
      if (results.length === 0) {
        const textContent = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").substring(0, 3000);
        return { success: true, output: `Search results (raw): ${textContent}` };
      }
      return { success: true, output: results.join("\n") };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async wait(args: { seconds: number }): Promise<ToolResult> {
    const secs = Math.min(args.seconds || 1, 60);
    await new Promise(resolve => setTimeout(resolve, secs * 1000));
    return { success: true, output: `Waited ${secs} seconds` };
  },

  async save_memory(args: { content: string; tags: string }): Promise<ToolResult> {
    try {
      await saveMemory(args.content, args.tags || "general", "agent");
      return { success: true, output: `Saved to memory: ${args.content.substring(0, 100)}` };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },
};

export async function executeTool(toolName: string, args: any): Promise<ToolResult> {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return { success: false, output: "", error: `Unknown tool: ${toolName}` };
  }

  try {
    return await handler(args);
  } catch (error: any) {
    return { success: false, output: "", error: `Tool execution error: ${error.message}` };
  }
}

export function getAvailableTools(): string[] {
  return Object.keys(toolHandlers);
}

function fetchUrl(url: string, options?: { method?: string; headers?: any; body?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const method = options?.method || "GET";

    const req = lib.request(url, {
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...options?.headers,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, options).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Request timeout")); });
    if (options?.body) req.write(options.body);
    req.end();
  });
}

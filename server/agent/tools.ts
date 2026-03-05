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
      const text = htmlToReadableText(response);
      const truncated = text.substring(0, 15000);
      return { success: true, output: truncated };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async execute_code(args: { code: string; description: string }): Promise<ToolResult> {
    try {
      const tmpFile = path.join("/tmp", `agent_code_${Date.now()}.js`);
      await fs.writeFile(tmpFile, args.code);
      const { stdout, stderr } = await execAsync(`node ${tmpFile}`, { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
      await fs.unlink(tmpFile).catch(() => {});
      return { success: true, output: (stdout + (stderr ? `\nSTDERR: ${stderr}` : "")).substring(0, 15000) };
    } catch (error: any) {
      return { success: false, output: error.stdout || "", error: (error.message || "").substring(0, 5000) };
    }
  },

  async run_command(args: { command: string }): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execAsync(args.command, { timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
      return { success: true, output: (stdout + (stderr ? `\nSTDERR: ${stderr}` : "")).substring(0, 15000) };
    } catch (error: any) {
      const output = (error.stdout || "") + (error.stderr ? `\nSTDERR: ${error.stderr}` : "");
      return { success: false, output: output.substring(0, 5000), error: (error.message || "").substring(0, 3000) };
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
      return { success: true, output: `Written to ${args.path} (${args.content.length} bytes)` };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async file_read(args: { path: string }): Promise<ToolResult> {
    try {
      const content = await fs.readFile(args.path, "utf-8");
      return { success: true, output: content.substring(0, 15000) };
    } catch (error: any) {
      return { success: false, output: "", error: error.message };
    }
  },

  async http_request(args: { method: string; url: string; headers?: any; body?: any; contentType?: string }): Promise<ToolResult> {
    try {
      const contentType = args.contentType || "application/json";
      let bodyStr: string | undefined;

      if (args.body) {
        if (contentType.includes("form-urlencoded") && typeof args.body === "object") {
          bodyStr = Object.entries(args.body)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");
        } else if (typeof args.body === "string") {
          bodyStr = args.body;
        } else {
          bodyStr = JSON.stringify(args.body);
        }
      }

      const headers: any = {
        "Content-Type": contentType,
        ...args.headers,
      };

      const response = await fetchUrlFull(args.url, {
        method: args.method,
        headers,
        body: bodyStr,
      });

      const output = [
        `Status: ${response.statusCode}`,
        `Headers: ${JSON.stringify(response.headers).substring(0, 500)}`,
        `Body:\n${response.body.substring(0, 10000)}`,
      ].join("\n");

      return { success: response.statusCode < 400, output };
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
        const allPlatforms = [...new Set(creds.filter(c => c.isActive).map(c => c.platform))];
        return {
          success: false,
          output: "",
          error: `No credentials found for "${args.platform}". ${allPlatforms.length > 0 ? `Available platforms: ${allPlatforms.join(", ")}. Try one of these instead.` : "No credentials stored at all. The user needs to add them via the dashboard first."}`
        };
      }
      const result = matching.map(c => {
        let password = "[decryption_failed]";
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
          } else {
            password = "[invalid_encrypted_format]";
            console.error(`[Credentials] Invalid encrypted format for ${c.platform}/${c.username} — expected 3 parts, got ${parts.length}`);
          }
        } catch (decryptErr: any) {
          console.error(`[Credentials] Decryption failed for ${c.platform}/${c.username}:`, decryptErr.message);
          password = `[decryption_failed: ${decryptErr.message}]`;
        }
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

      const resultBlocks = html.split(/class="result\s/g);
      for (let i = 1; i < resultBlocks.length && results.length < 8; i++) {
        const block = resultBlocks[i];

        let title = "";
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)/);
        if (titleMatch) {
          title = titleMatch[1].replace(/<[^>]*>/g, "").trim();
        }

        let link = "";
        const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"/);
        if (linkMatch) {
          link = linkMatch[1];
          if (link.includes("uddg=")) {
            const decoded = decodeURIComponent(link.split("uddg=")[1]?.split("&")[0] || "");
            if (decoded) link = decoded;
          }
        }

        let snippet = "";
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        if (snippetMatch) {
          snippet = snippetMatch[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        }

        if (title && link) {
          results.push(`${results.length + 1}. ${title}\n   URL: ${link}${snippet ? `\n   ${snippet}` : ""}`);
        }
      }

      if (results.length === 0) {
        const linkRegex = /class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)/g;
        let match;
        let count = 0;
        while ((match = linkRegex.exec(html)) !== null && count < 8) {
          results.push(`${count + 1}. ${match[2].trim()}: ${match[1]}`);
          count++;
        }
      }

      if (results.length === 0) {
        const textContent = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").substring(0, 5000);
        return { success: true, output: `Search results (raw text, parsing failed):\n${textContent}` };
      }

      return { success: true, output: `Search results for "${args.query}":\n\n${results.join("\n\n")}` };
    } catch (error: any) {
      return { success: false, output: "", error: `Web search failed: ${error.message}. Try using run_command with curl instead: curl "https://html.duckduckgo.com/html/?q=your+query"` };
    }
  },

  async wait(args: { seconds: number }): Promise<ToolResult> {
    const secs = Math.min(args.seconds || 1, 120);
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
    const available = Object.keys(toolHandlers).join(", ");
    return { success: false, output: "", error: `Unknown tool: "${toolName}". Available tools: ${available}` };
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

function htmlToReadableText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n## $1\n\n");
  text = text.replace(/<p[^>]*>/gi, "\n\n");
  text = text.replace(/<\/p>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");
  return text.trim();
}

function fetchUrl(url: string, options?: { method?: string; headers?: any; body?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const method = options?.method || "GET";

    const req = lib.request(url, {
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...options?.headers,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith("/")) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        fetchUrl(redirectUrl, options).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Request timeout (30s)")); });
    if (options?.body) req.write(options.body);
    req.end();
  });
}

interface FullResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function fetchUrlFull(url: string, options?: { method?: string; headers?: any; body?: string }): Promise<FullResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const method = options?.method || "GET";

    const req = lib.request(url, {
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        ...options?.headers,
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: data,
      }));
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Request timeout (30s)")); });
    if (options?.body) req.write(options.body);
    req.end();
  });
}

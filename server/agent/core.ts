import { storage } from "../storage";
import { chatCompletion } from "./openrouter";
import { executeTool } from "./tools";
import { AGENT_SYSTEM_PROMPT, buildTaskPrompt } from "./prompt";
import { searchMemory, saveTaskMemory } from "./memory";
import type { Task } from "@shared/schema";

interface AgentStep {
  thinking: string;
  plan: string;
  tool: string | null;
  args: any;
  done: boolean;
  summary: string;
  result?: string;
}

type ProgressCallback = (taskId: number, step: number, message: string, status: string) => void;

const MAX_STEPS = 50;
const COMPACTION_THRESHOLD = 30;
const activeTasks = new Map<number, boolean>();

const API_KEY_PHRASES = [
  "api key", "api_key", "apikey", "client_id", "client_secret",
  "oauth token", "oauth2", "access_token", "bearer token",
  "developer account", "developer portal", "register an app",
  "create an application", "app credentials",
];

export function isTaskRunning(taskId: number): boolean {
  return activeTasks.get(taskId) === true;
}

export function cancelTask(taskId: number): void {
  activeTasks.set(taskId, false);
}

async function compactHistory(
  conversationHistory: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<{ tokensUsed: number; cost: number }> {
  if (conversationHistory.length < COMPACTION_THRESHOLD) return { tokensUsed: 0, cost: 0 };

  const system = conversationHistory[0];
  const oldMessages = conversationHistory.slice(1, -15);
  const recentMessages = conversationHistory.slice(-15);

  if (oldMessages.length < 5) return { tokensUsed: 0, cost: 0 };

  const summaryPrompt = oldMessages.map(m => `[${m.role}]: ${m.content.substring(0, 600)}`).join("\n");

  try {
    const result = await chatCompletion([
      { role: "system", content: "Summarize this conversation history concisely but thoroughly. MUST INCLUDE: all credentials/passwords discovered, login methods that worked, URLs and endpoints used, file paths created, tools that succeeded vs failed, key decisions made, current task state. Be factual and preserve ALL technical details." },
      { role: "user", content: summaryPrompt }
    ], 0.3);

    conversationHistory.length = 0;
    conversationHistory.push(
      system,
      { role: "user", content: `[CONVERSATION SUMMARY]\n${result.content}\n[END SUMMARY]` },
      ...recentMessages
    );
    return { tokensUsed: result.tokensUsed, cost: result.cost };
  } catch (err: any) {
    console.error("[Core] Compaction failed:", err.message || err);
    const keepRecent = conversationHistory.slice(-20);
    conversationHistory.length = 0;
    conversationHistory.push(system, ...keepRecent);
    return { tokensUsed: 0, cost: 0 };
  }
}

function detectApiKeyBegging(content: string): boolean {
  const lower = content.toLowerCase();
  return API_KEY_PHRASES.some(phrase => lower.includes(phrase));
}

function makeToolSignature(tool: string, args: any): string {
  try {
    return `${tool}:${JSON.stringify(args)}`;
  } catch {
    return `${tool}:unknown`;
  }
}

export async function executeTask(
  task: Task,
  onProgress?: ProgressCallback
): Promise<void> {
  activeTasks.set(task.id, true);
  await storage.updateTask(task.id, { status: "running" });

  const relevantMemory = await searchMemory(task.description);

  const conversationHistory: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: buildTaskPrompt(task.description, undefined, relevantMemory || undefined) },
  ];

  let step = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const failedApproaches: string[] = [];
  const toolCallHistory: string[] = [];

  try {
    while (step < MAX_STEPS && activeTasks.get(task.id)) {
      step++;
      const remaining = MAX_STEPS - step;

      onProgress?.(task.id, step, `Thinking (step ${step}/${MAX_STEPS})...`, "info");

      const compactionResult = await compactHistory(conversationHistory);
      if (compactionResult.tokensUsed > 0) {
        totalTokens += compactionResult.tokensUsed;
        totalCost += compactionResult.cost;
      }

      const result = await chatCompletion(conversationHistory, 0.7);
      totalTokens += result.tokensUsed;
      totalCost += result.cost;

      await storage.updateTask(task.id, {
        totalTokens,
        totalCostUsd: totalCost.toFixed(6),
      });

      let parsed: AgentStep;
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        await storage.createTaskLog({
          taskId: task.id,
          step,
          action: "ai_response",
          detail: result.content.substring(0, 2000),
          toolUsed: null,
          status: "info",
          tokenCount: result.tokensUsed,
          costUsd: result.cost.toFixed(6),
        });

        conversationHistory.push(
          { role: "assistant", content: result.content },
          { role: "user", content: "Your response was not valid JSON. You MUST respond with a JSON object containing: thinking, plan, tool, args, done, summary. Try again." }
        );
        continue;
      }

      if (detectApiKeyBegging(result.content)) {
        conversationHistory.push(
          { role: "assistant", content: result.content },
          { role: "user", content: `STOP. You are asking for API keys/credentials/OAuth/client_id. This is WRONG.

You have the get_credentials tool — call it to get stored username and password.
When you have username+password, LOG IN VIA THE WEB:
1. Write a Python script using requests.Session()
2. POST to the site's login form with username+password
3. Use the session cookies for subsequent requests

You do NOT need API keys, client_id, client_secret, or OAuth tokens.
You do NOT need to register a developer app.
You log in like a PERSON would — with username and password via web form.

If you don't know the login URL, call search_web to find it.
Resume the task NOW using web login. You have ${remaining} steps left.` }
        );
        continue;
      }

      onProgress?.(task.id, step, parsed.summary || parsed.thinking, parsed.done ? "completed" : "info");

      if (parsed.done) {
        await storage.createTaskLog({
          taskId: task.id,
          step,
          action: "task_complete",
          detail: parsed.result || parsed.summary,
          toolUsed: null,
          status: "success",
          tokenCount: result.tokensUsed,
          costUsd: result.cost.toFixed(6),
        });

        await storage.updateTask(task.id, {
          status: "completed",
          result: parsed.result || parsed.summary,
          completedAt: new Date(),
          totalTokens,
          totalCostUsd: totalCost.toFixed(6),
        });

        try {
          await saveTaskMemory(task.title, parsed.result || parsed.summary || "", totalTokens, totalCost.toFixed(4));
        } catch (memErr: any) {
          console.error("[Core] Failed to save task memory:", memErr.message || memErr);
        }

        activeTasks.delete(task.id);
        return;
      }

      if (parsed.tool && parsed.args) {
        const toolSig = makeToolSignature(parsed.tool, parsed.args);
        const repeatCount = toolCallHistory.filter(s => s === toolSig).length;

        if (repeatCount >= 2) {
          conversationHistory.push(
            { role: "assistant", content: result.content },
            { role: "user", content: `STUCK DETECTION: You have called "${parsed.tool}" with the EXACT same arguments ${repeatCount + 1} times. This is not working.

You MUST try a FUNDAMENTALLY DIFFERENT approach:
- Different tool (run_command instead of http_request, or vice versa)
- Different method (Python script instead of direct HTTP, or curl instead of Python)
- Different endpoint or URL
- Search the web for alternative methods

Previous failed approaches: ${failedApproaches.length > 0 ? failedApproaches.join("; ") : "none recorded yet"}
You have ${remaining} steps left. Do NOT repeat the same call.` }
          );
          continue;
        }

        toolCallHistory.push(toolSig);

        await storage.createTaskLog({
          taskId: task.id,
          step,
          action: `tool:${parsed.tool}`,
          detail: `${parsed.summary}\nArgs: ${JSON.stringify(parsed.args).substring(0, 500)}`,
          toolUsed: parsed.tool,
          status: "info",
          tokenCount: result.tokensUsed,
          costUsd: result.cost.toFixed(6),
        });

        onProgress?.(task.id, step, `Using ${parsed.tool}...`, "info");

        const toolResult = await executeTool(parsed.tool, parsed.args);

        await storage.createTaskLog({
          taskId: task.id,
          step,
          action: `tool_result:${parsed.tool}`,
          detail: toolResult.success
            ? toolResult.output.substring(0, 2000)
            : `ERROR: ${toolResult.error}`,
          toolUsed: parsed.tool,
          status: toolResult.success ? "success" : "failure",
        });

        if (toolResult.success) {
          conversationHistory.push(
            { role: "assistant", content: result.content },
            {
              role: "user",
              content: `Tool "${parsed.tool}" executed successfully. Output:\n${toolResult.output.substring(0, 4000)}\n\nContinue with the next step.`,
            }
          );
        } else {
          const failDesc = `${parsed.tool}(${JSON.stringify(parsed.args).substring(0, 100)}): ${(toolResult.error || "").substring(0, 100)}`;
          failedApproaches.push(failDesc);

          conversationHistory.push(
            { role: "assistant", content: result.content },
            {
              role: "user",
              content: `Tool "${parsed.tool}" FAILED. Error: ${toolResult.error}

ALL PREVIOUS FAILED APPROACHES:
${failedApproaches.map((f, i) => `${i + 1}. ${f}`).join("\n")}

You MUST try a COMPLETELY DIFFERENT method. Do NOT repeat any of the above.
Suggestions:
- If HTTP failed → try writing a Python script with run_command instead
- If Python failed → try curl with run_command
- If login failed → search_web for "how to login to [site] programmatically 2024"
- If a library is missing → install it first with run_command "pip3 install [lib]"
- If blocked/403 → try different User-Agent, try mobile endpoint, try old/legacy version of the site

You have ${remaining} steps left. Make them count.`,
            }
          );
        }
      } else {
        conversationHistory.push(
          { role: "assistant", content: result.content },
          { role: "user", content: `Continue. Use a tool to take action — don't just think. If the task is done, set done: true with a result. You have ${remaining} steps left.` }
        );
      }
    }

    if (!activeTasks.get(task.id)) {
      await storage.updateTask(task.id, {
        status: "paused",
        error: "Task cancelled by user",
      });
    } else {
      await storage.updateTask(task.id, {
        status: "failed",
        error: `Task exceeded maximum steps (${MAX_STEPS}). Failed approaches: ${failedApproaches.join("; ") || "none"}`,
      });
    }
  } catch (error: any) {
    console.error(`Task ${task.id} execution error:`, error);
    await storage.createTaskLog({
      taskId: task.id,
      step: step + 1,
      action: "fatal_error",
      detail: error.message,
      toolUsed: null,
      status: "failure",
    });

    const currentTask = await storage.getTask(task.id);
    if (currentTask && currentTask.retryCount < currentTask.maxRetries) {
      await storage.updateTask(task.id, {
        status: "pending",
        retryCount: currentTask.retryCount + 1,
        error: `Retry ${currentTask.retryCount + 1}/${currentTask.maxRetries}: ${error.message}`,
      });
    } else {
      await storage.updateTask(task.id, {
        status: "failed",
        error: error.message,
      });
    }
  } finally {
    activeTasks.delete(task.id);
  }
}

export async function retryTask(taskId: number, onProgress?: ProgressCallback): Promise<void> {
  const task = await storage.getTask(taskId);
  if (!task) throw new Error("Task not found");

  await storage.updateTask(taskId, { status: "pending", error: null });
  await executeTask(task, onProgress);
}

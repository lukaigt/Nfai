import { storage } from "../storage";
import { chatCompletion } from "./openrouter";
import { executeTool } from "./tools";
import { AGENT_SYSTEM_PROMPT, buildTaskPrompt } from "./prompt";
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

const MAX_STEPS = 30;
const activeTasks = new Map<number, boolean>();

export function isTaskRunning(taskId: number): boolean {
  return activeTasks.get(taskId) === true;
}

export function cancelTask(taskId: number): void {
  activeTasks.set(taskId, false);
}

export async function executeTask(
  task: Task,
  onProgress?: ProgressCallback
): Promise<void> {
  activeTasks.set(task.id, true);

  await storage.updateTask(task.id, { status: "running" });

  const conversationHistory: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: buildTaskPrompt(task.description) },
  ];

  let step = 0;
  let totalTokens = 0;
  let totalCost = 0;

  try {
    while (step < MAX_STEPS && activeTasks.get(task.id)) {
      step++;

      onProgress?.(task.id, step, `Thinking (step ${step})...`, "info");

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
          { role: "user", content: "Please respond with valid JSON as specified in your instructions." }
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

        activeTasks.delete(task.id);
        return;
      }

      if (parsed.tool && parsed.args) {
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

        onProgress?.(task.id, step, `Executing tool: ${parsed.tool}`, "info");

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

        conversationHistory.push(
          { role: "assistant", content: result.content },
          {
            role: "user",
            content: toolResult.success
              ? `Tool "${parsed.tool}" executed successfully. Output:\n${toolResult.output.substring(0, 3000)}\n\nContinue with the next step.`
              : `Tool "${parsed.tool}" FAILED. Error: ${toolResult.error}\n\nTry an alternative approach. Do NOT give up.`,
          }
        );
      } else {
        conversationHistory.push(
          { role: "assistant", content: result.content },
          { role: "user", content: "Continue. If you need to use a tool, specify it. If the task is done, set done: true." }
        );
      }

      if (conversationHistory.length > 40) {
        const system = conversationHistory[0];
        const initial = conversationHistory[1];
        const recent = conversationHistory.slice(-20);
        const summary = `[Previous steps summarized: Completed ${step - 10} steps. Key actions taken so far.]`;
        conversationHistory.length = 0;
        conversationHistory.push(system, initial, { role: "user", content: summary }, ...recent);
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
        error: `Task exceeded maximum steps (${MAX_STEPS}). Partial progress saved.`,
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

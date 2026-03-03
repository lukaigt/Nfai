import OpenAI from "openai";
import { storage } from "../storage";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionResult {
  content: string;
  tokensUsed: number;
  model: string;
  cost: number;
}

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "deepseek/deepseek-chat-v3-0324": { input: 0.0000003, output: 0.0000008 },
  "deepseek/deepseek-chat": { input: 0.0000003, output: 0.0000008 },
  "deepseek/deepseek-r1": { input: 0.000001, output: 0.000004 },
  "moonshotai/kimi-k2": { input: 0.0000006, output: 0.0000006 },
  "moonshotai/moonlight-16b-a3b-instruct": { input: 0.00000008, output: 0.00000025 },
  "openai/gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
  "anthropic/claude-sonnet-4": { input: 0.000003, output: 0.000015 },
  "google/gemini-2.5-flash-preview": { input: 0.00000015, output: 0.0000006 },
};

async function getOpenRouterClient(): Promise<OpenAI> {
  const apiKeySetting = await storage.getSetting("openrouter_api_key");
  const baseUrlSetting = await storage.getSetting("openrouter_base_url");

  const apiKey = apiKeySetting?.value || process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "";
  const baseURL = baseUrlSetting?.value || process.env.OPENROUTER_BASE_URL || process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  return new OpenAI({ apiKey, baseURL });
}

async function getModel(): Promise<string> {
  const modelSetting = await storage.getSetting("ai_model");
  return modelSetting?.value || "deepseek/deepseek-chat-v3-0324";
}

export async function chatCompletion(messages: ChatMessage[], temperature = 0.7): Promise<CompletionResult> {
  const client = await getOpenRouterClient();
  const model = await getModel();

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content || "";
  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens || 0;
  const outputTokens = usage?.completion_tokens || 0;
  const tokensUsed = inputTokens + outputTokens;

  const costInfo = MODEL_COSTS[model] || { input: 0.000001, output: 0.000002 };
  const cost = (inputTokens * costInfo.input) + (outputTokens * costInfo.output);

  return { content, tokensUsed, model, cost };
}

export async function streamCompletion(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  temperature = 0.7
): Promise<CompletionResult> {
  const client = await getOpenRouterClient();
  const model = await getModel();

  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: 4096,
    stream: true,
  });

  let fullContent = "";
  let tokensUsed = 0;

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      fullContent += content;
      onChunk(content);
    }
    if (chunk.usage) {
      tokensUsed = (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0);
    }
  }

  if (tokensUsed === 0) {
    tokensUsed = Math.ceil(fullContent.length / 4) + 500;
  }

  const costInfo = MODEL_COSTS[model] || { input: 0.000001, output: 0.000002 };
  const cost = tokensUsed * ((costInfo.input + costInfo.output) / 2);

  return { content: fullContent, tokensUsed, model, cost };
}

export async function testConnection(): Promise<{ success: boolean; model: string; error?: string }> {
  try {
    const model = await getModel();
    const result = await chatCompletion([
      { role: "user", content: "Reply with exactly: CONNECTED" }
    ], 0);
    return { success: result.content.includes("CONNECTED"), model };
  } catch (error: any) {
    return { success: false, model: "", error: error.message };
  }
}

export function getAvailableModels() {
  return Object.keys(MODEL_COSTS).map(id => ({
    id,
    inputCost: MODEL_COSTS[id].input,
    outputCost: MODEL_COSTS[id].output,
  }));
}

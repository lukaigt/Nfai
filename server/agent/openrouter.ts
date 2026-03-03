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
  "deepseek/deepseek-r1-0528": { input: 0.000001, output: 0.000004 },
  "deepseek/deepseek-prover-v2": { input: 0.000003, output: 0.000008 },
  "moonshotai/kimi-k2": { input: 0.0000006, output: 0.0000006 },
  "openai/gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
  "openai/gpt-4o": { input: 0.0000025, output: 0.00001 },
  "anthropic/claude-sonnet-4": { input: 0.000003, output: 0.000015 },
  "google/gemini-2.5-flash-preview": { input: 0.00000015, output: 0.0000006 },
};

interface OpenRouterModel {
  id: string;
  name: string;
  inputCost: number;
  outputCost: number;
}

let cachedModels: OpenRouterModel[] | null = null;
let cacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000;

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (cachedModels && Date.now() - cacheTime < CACHE_DURATION) {
    return cachedModels;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const models: OpenRouterModel[] = (data.data || [])
      .filter((m: any) => m.id && m.pricing)
      .map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        inputCost: parseFloat(m.pricing?.prompt || "0"),
        outputCost: parseFloat(m.pricing?.completion || "0"),
      }))
      .sort((a: OpenRouterModel, b: OpenRouterModel) => a.id.localeCompare(b.id));

    cachedModels = models;
    cacheTime = Date.now();
    console.log(`[OpenRouter] Fetched ${models.length} models`);
    return models;
  } catch (error: any) {
    console.error("[OpenRouter] Failed to fetch models:", error.message);
    return Object.keys(MODEL_COSTS).map(id => ({
      id,
      name: id,
      inputCost: MODEL_COSTS[id].input,
      outputCost: MODEL_COSTS[id].output,
    }));
  }
}

async function getOpenRouterClient(overrideKey?: string, overrideUrl?: string): Promise<OpenAI> {
  const apiKeySetting = await storage.getSetting("openrouter_api_key");
  const baseUrlSetting = await storage.getSetting("openrouter_base_url");

  const apiKey = overrideKey || apiKeySetting?.value || process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "";
  const baseURL = overrideUrl || baseUrlSetting?.value || process.env.OPENROUTER_BASE_URL || process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("No API key configured. Enter your OpenRouter API key and click Save, then test.");
  }

  return new OpenAI({ apiKey, baseURL });
}

async function getModel(): Promise<string> {
  const modelSetting = await storage.getSetting("ai_model");
  return modelSetting?.value || process.env.AI_MODEL || "deepseek/deepseek-chat-v3-0324";
}

export function getModelCost(modelId: string): { input: number; output: number } {
  return MODEL_COSTS[modelId] || { input: 0.000001, output: 0.000002 };
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

  const costInfo = getModelCost(model);
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

  const costInfo = getModelCost(model);
  const cost = tokensUsed * ((costInfo.input + costInfo.output) / 2);

  return { content: fullContent, tokensUsed, model, cost };
}

export async function testConnection(options?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ success: boolean; model: string; error?: string }> {
  try {
    const apiKey = options?.apiKey;
    const baseUrl = options?.baseUrl;
    const model = options?.model || await getModel();

    const client = await getOpenRouterClient(apiKey, baseUrl);

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with exactly: CONNECTED" }],
      temperature: 0,
      max_tokens: 50,
    });

    const content = response.choices[0]?.message?.content || "";
    const success = content.toUpperCase().includes("CONNECTED");
    return { success, model };
  } catch (error: any) {
    const msg = error.message || "Unknown error";
    console.error("[AI Test] Connection failed:", msg);

    let friendlyError = msg;
    if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("auth")) {
      friendlyError = "Invalid API key. Check your OpenRouter key at openrouter.ai/keys";
    } else if (msg.includes("404") || msg.includes("not found")) {
      friendlyError = "Model not found. Check if the model ID is correct on OpenRouter.";
    } else if (msg.includes("429") || msg.includes("rate")) {
      friendlyError = "Rate limited. Wait a moment and try again.";
    } else if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      friendlyError = "Cannot reach OpenRouter. Check your Base URL and internet connection.";
    } else if (msg.includes("No API key")) {
      friendlyError = msg;
    }

    return { success: false, model: "", error: friendlyError };
  }
}

export function getAvailableModels() {
  return Object.keys(MODEL_COSTS).map(id => ({
    id,
    inputCost: MODEL_COSTS[id].input,
    outputCost: MODEL_COSTS[id].output,
  }));
}

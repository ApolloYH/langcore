import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_LLM_MODEL = "deepseek-v4-pro";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

export interface AnthropicCompatibleClientOptions {
  apiKey?: string;
  baseURL?: string;
}

export function resolveModel(model?: string) {
  return model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_LLM_MODEL;
}

export function createAnthropicCompatibleClient(options: AnthropicCompatibleClientOptions = {}) {
  return new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: options.baseURL ?? process.env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL
  });
}

import Anthropic from "@anthropic-ai/sdk";
import type { SearchResult } from "@devscope/shared";

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

type MessagesClient = Pick<Anthropic["messages"], "create">;

export interface RagAnswerOptions {
  apiKey?: string;
  baseURL?: string;
  client?: MessagesClient;
  maxTokens?: number;
  model?: string;
}

export async function generateRagAnswer(
  query: string,
  results: SearchResult[],
  options: RagAnswerOptions = {}
): Promise<string> {
  if (results.length === 0) {
    return "No matching repository context has been ingested yet.";
  }

  const client = options.client ?? createAnthropicClient(options).messages;
  const response = await client.create({
    max_tokens: options.maxTokens ?? 800,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Answer the user question using only the provided repository and Hacker News context.",
              "Cite source titles inline when useful. If context is insufficient, say what is missing.",
              `Question: ${query}`,
              "Context:",
              ...results.map(
                (result, index) =>
                  `[${index + 1}] ${result.title} (${result.sourceType}, score ${result.score.toFixed(3)}):\n${result.content}`
              )
            ].join("\n\n")
          }
        ]
      }
    ],
    model: options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL
  });

  const text = response.content.find((block) => block.type === "text");
  if (!text) {
    throw new Error("Claude did not return a text answer.");
  }

  return text.text;
}

function createAnthropicClient(options: Pick<RagAnswerOptions, "apiKey" | "baseURL">) {
  const baseURL = options.baseURL ?? process.env.ANTHROPIC_BASE_URL;

  return new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    ...(baseURL ? { baseURL } : {})
  });
}

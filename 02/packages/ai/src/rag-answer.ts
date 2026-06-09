import Anthropic from "@anthropic-ai/sdk";
import type { SearchResult } from "@devscope/shared";

import { createAnthropicCompatibleClient, resolveModel } from "./model-config";

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

  const client = options.client ?? createAnthropicCompatibleClient(options).messages;
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
              "Cite source titles inline and mention source URLs when useful. If context is insufficient, say what is missing.",
              `Question: ${query}`,
              "Context:",
              ...results.map(
                (result, index) =>
                  `[${index + 1}] ${result.title} (${result.sourceType}, score ${result.score.toFixed(3)}, url ${
                    result.sourceUrl ?? "none"
                  }):\n${result.content}`
              )
            ].join("\n\n")
          }
        ]
      }
    ],
    model: resolveModel(options.model)
  });

  const text = response.content.find((block) => block.type === "text");
  if (!text) {
    throw new Error("Claude did not return a text answer.");
  }

  return text.text;
}

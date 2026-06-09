import Anthropic from "@anthropic-ai/sdk";
import {
  GithubProjectAnalysisInputSchema,
  GithubProjectAnalysisSchema,
  type GithubProjectAnalysis,
  type GithubProjectAnalysisInput
} from "@devscope/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

import { createAnthropicCompatibleClient, resolveModel } from "./model-config";

const TOOL_NAME = "record_github_project_analysis";

type MessagesClient = Pick<Anthropic["messages"], "create">;

export interface GithubAnalyzerOptions {
  apiKey?: string;
  baseURL?: string;
  client?: MessagesClient;
  maxTokens?: number;
  model?: string;
}

export async function analyzeGithubProject(
  input: GithubProjectAnalysisInput,
  options: GithubAnalyzerOptions = {}
): Promise<GithubProjectAnalysis> {
  const parsedInput = GithubProjectAnalysisInputSchema.parse(input);
  const client = options.client ?? createAnthropicCompatibleClient(options).messages;

  const response = await client.create({
    max_tokens: options.maxTokens ?? 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Analyze this GitHub project and return the result only by calling the required tool.",
              "Use lowercase enum values exactly as defined by the tool schema.",
              `Project data: ${JSON.stringify(parsedInput)}`
            ].join("\n")
          }
        ]
      }
    ],
    model: resolveModel(options.model),
    tool_choice: { type: "tool", name: TOOL_NAME },
    tools: [
      {
        name: TOOL_NAME,
        description: "Return a structured GitHub project investment analysis.",
        input_schema: zodToJsonSchema(GithubProjectAnalysisSchema, {
          $refStrategy: "none"
        }) as Anthropic.Tool.InputSchema
      }
    ]
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );

  if (!toolUse) {
    throw new Error("Claude did not return the required GitHub analysis tool call.");
  }

  return GithubProjectAnalysisSchema.parse(toolUse.input);
}

import Anthropic from "@anthropic-ai/sdk";
import {
  GithubProjectAnalysisInputSchema,
  GithubProjectAnalysisSchema,
  type GithubProjectAnalysis,
  type GithubProjectAnalysisInput
} from "@devscope/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

const TOOL_NAME = "record_github_project_analysis";
const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

type MessagesClient = Pick<Anthropic["messages"], "create">;

export interface GithubAnalyzerOptions {
  apiKey?: string;
  client?: MessagesClient;
  maxTokens?: number;
  model?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export async function analyzeGithubProject(
  input: GithubProjectAnalysisInput,
  options: GithubAnalyzerOptions = {}
): Promise<GithubProjectAnalysis> {
  const parsedInput = GithubProjectAnalysisInputSchema.parse(input);
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey }).messages;

  const response = await createWithRetry(
    () =>
      client.create({
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
        model: options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
        thinking: { type: "disabled" },
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
      }),
    {
      maxRetries: options.maxRetries ?? 2,
      retryDelayMs: options.retryDelayMs ?? 300
    }
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );

  if (!toolUse) {
    throw new Error("Claude did not return the required GitHub analysis tool call.");
  }

  return GithubProjectAnalysisSchema.parse(toolUse.input);
}

async function createWithRetry<T>(
  createMessage: () => Promise<T>,
  options: { maxRetries: number; retryDelayMs: number }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await createMessage();
    } catch (error) {
      lastError = error;

      if (attempt === options.maxRetries || !isRetryableError(error)) {
        throw error;
      }

      await delay(options.retryDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

function isRetryableError(error: unknown) {
  if (!(typeof error === "object" && error !== null)) {
    return true;
  }

  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (!status) {
    return true;
  }

  return status === 429 || status >= 500;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

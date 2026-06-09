import Anthropic from "@anthropic-ai/sdk";
import type { Citation, SearchResult } from "@devscope/shared";

import { createAnthropicCompatibleClient, resolveModel } from "./model-config";

const MAX_CONTEXT_CHARS = 4200;

type MessagesClient = Pick<Anthropic["messages"], "create">;

export interface QueryRewriteOptions {
  apiKey?: string;
  baseURL?: string;
  client?: MessagesClient;
  model?: string;
}

export async function rewriteRagQuery(query: string, options: QueryRewriteOptions = {}) {
  const localRewrite = createLocalQueryRewrite(query);
  const client = options.client ?? createOptionalAnthropicClient(options)?.messages;

  if (!client) {
    return localRewrite;
  }

  try {
    const response = await client.create({
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Rewrite this repository research question for hybrid search.",
                "Keep it short. Add likely synonyms and concrete GitHub/Hacker News terms.",
                "Return only the rewritten query.",
                `Question: ${query}`
              ].join("\n")
            }
          ]
        }
      ],
      model: resolveModel(options.model)
    });

    const text = response.content.find((block) => block.type === "text");
    return text?.text.trim() || localRewrite;
  } catch {
    return localRewrite;
  }
}

export function compressSearchResults(results: SearchResult[], query: string, maxChars = MAX_CONTEXT_CHARS) {
  const queryTerms = new Set(tokenize(query));
  const compressed: SearchResult[] = [];
  let usedChars = 0;

  for (const result of rerankSearchResults(results, query)) {
    const content = selectRelevantSentences(result.content, queryTerms);
    const remaining = maxChars - usedChars;

    if (remaining <= 0) {
      break;
    }

    const truncated = content.slice(0, remaining);
    usedChars += truncated.length;
    compressed.push({
      ...result,
      content: truncated
    });
  }

  return compressed;
}

export function buildCitations(results: SearchResult[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const result of results) {
    const key = `${result.title}:${result.sourceUrl ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    citations.push({
      title: result.title,
      sourceType: result.sourceType,
      sourceUrl: result.sourceUrl
    });
  }

  return citations;
}

export function rerankSearchResults(results: SearchResult[], query: string) {
  const queryTerms = new Set(tokenize(query));

  return [...results].sort((left, right) => {
    const leftScore = left.score + lexicalOverlap(left.content, queryTerms) * 0.2;
    const rightScore = right.score + lexicalOverlap(right.content, queryTerms) * 0.2;
    return rightScore - leftScore;
  });
}

function createLocalQueryRewrite(query: string) {
  return `${query} github repository readme issues stars contributors hacker news discussion risks opportunities`;
}

function selectRelevantSentences(content: string, queryTerms: Set<string>) {
  const sentences = content.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0) {
    return content;
  }

  const selected = sentences.filter((sentence) => lexicalOverlap(sentence, queryTerms) > 0);
  return (selected.length > 0 ? selected : sentences.slice(0, 3)).join(" ");
}

function lexicalOverlap(text: string, queryTerms: Set<string>) {
  const terms = tokenize(text);
  if (terms.length === 0 || queryTerms.size === 0) {
    return 0;
  }

  const matches = terms.filter((term) => queryTerms.has(term)).length;
  return matches / terms.length;
}

function tokenize(text: string) {
  return text.toLowerCase().match(/[a-z0-9_+#.-]+/g) ?? [];
}

function createOptionalAnthropicClient(options: Pick<QueryRewriteOptions, "apiKey" | "baseURL">) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  return createAnthropicCompatibleClient({ apiKey, baseURL: options.baseURL });
}

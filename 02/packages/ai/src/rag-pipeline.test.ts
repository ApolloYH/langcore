import type { SearchResult } from "@devscope/shared";
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCitations, compressSearchResults, rerankSearchResults, rewriteRagQuery } from "./rag-pipeline";

const createMock = vi.hoisted(() => vi.fn());
const AnthropicMock = vi.hoisted(() =>
  vi.fn(function Anthropic() {
    return {
      messages: {
        create: createMock
      }
    };
  })
);

vi.mock("@anthropic-ai/sdk", () => ({
  default: AnthropicMock
}));

const readmeResult: SearchResult = {
  id: "doc-1",
  owner: "vercel",
  repo: "next.js",
  sourceType: "github_readme",
  sourceUrl: "https://github.com/vercel/next.js",
  title: "Next.js README",
  chunkIndex: 0,
  content: "Next.js supports React server components. It also provides routing, rendering, and data fetching.",
  score: 0.6,
  vectorScore: 0.6,
  keywordScore: 0.1
};

const hnResult: SearchResult = {
  id: "doc-2",
  owner: "vercel",
  repo: "next.js",
  sourceType: "hacker_news",
  sourceUrl: "https://news.ycombinator.com/item?id=1",
  title: "HN discussion",
  chunkIndex: 0,
  content: "Developers discuss Next.js risks around upgrades, complexity, and framework churn.",
  score: 0.55,
  vectorScore: 0.55,
  keywordScore: 0.2
};

describe("rag pipeline helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites locally when no LLM client or API key is configured", async () => {
    const rewritten = await rewriteRagQuery("What are the risks?");

    expect(rewritten).toContain("What are the risks?");
    expect(rewritten).toContain("hacker news");
  });

  it("uses the configured LLM client for query rewriting", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "next.js risks upgrades hacker news" }]
    });

    const rewritten = await rewriteRagQuery("What are the risks?", {
      client: { create },
      model: "deepseek-v4-pro"
    });

    expect(rewritten).toBe("next.js risks upgrades hacker news");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 120,
        model: "deepseek-v4-pro"
      })
    );
  });

  it("constructs an Anthropic-compatible client when API settings are provided", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "repo adoption issue backlog readme" }]
    });

    const rewritten = await rewriteRagQuery("How healthy is it?", {
      apiKey: "test-key",
      baseURL: "https://api.deepseek.com/anthropic"
    });

    expect(rewritten).toBe("repo adoption issue backlog readme");
    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://api.deepseek.com/anthropic"
    });
  });

  it("falls back to the local rewritten query when LLM rewriting fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    const rewritten = await rewriteRagQuery("What are the risks?", {
      client: { create }
    });

    expect(rewritten).toContain("What are the risks?");
    expect(rewritten).toContain("opportunities");
  });

  it("falls back when the LLM returns no text block", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "unexpected", input: {} }]
    });

    const rewritten = await rewriteRagQuery("What are the risks?", {
      client: { create }
    });

    expect(rewritten).toContain("What are the risks?");
  });

  it("reranks search results with lexical overlap", () => {
    const ranked = rerankSearchResults([readmeResult, hnResult], "risks upgrades complexity");

    expect(ranked[0]?.id).toBe("doc-2");
  });

  it("keeps vector order when the query has no lexical terms", () => {
    const ranked = rerankSearchResults([readmeResult, hnResult], "");

    expect(ranked[0]?.id).toBe("doc-1");
  });

  it("compresses context while preserving the most relevant snippets", () => {
    const compressed = compressSearchResults([readmeResult, hnResult], "server components", 90);

    expect(compressed).toHaveLength(2);
    expect(compressed[0]?.content.length).toBeLessThanOrEqual(90);
    expect(compressed.map((result) => result.sourceUrl)).toContain("https://github.com/vercel/next.js");
  });

  it("stops compression when the context budget is exhausted", () => {
    const compressed = compressSearchResults([readmeResult], "server components", 0);

    expect(compressed).toHaveLength(0);
  });

  it("uses leading content when no sentence overlaps the query", () => {
    const compressed = compressSearchResults([readmeResult], "security audit", 200);

    expect(compressed[0]?.content).toContain("Next.js supports React server components.");
  });

  it("deduplicates citations by title and URL", () => {
    const citations = buildCitations([readmeResult, readmeResult, hnResult]);

    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      title: "Next.js README",
      sourceType: "github_readme",
      sourceUrl: "https://github.com/vercel/next.js"
    });
  });
});

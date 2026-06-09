import type { SearchResult } from "@devscope/shared";
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateRagAnswer } from "./rag-answer";

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

const result: SearchResult = {
  id: "doc-1",
  owner: "vercel",
  repo: "next.js",
  sourceType: "github_readme",
  sourceUrl: "https://github.com/vercel/next.js",
  title: "README",
  chunkIndex: 0,
  content: "Next.js is a React framework.",
  score: 0.91
};

describe("generateRagAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a fallback answer when there are no search results", async () => {
    await expect(generateRagAnswer("What is this repo?", [])).resolves.toBe(
      "No matching repository context has been ingested yet."
    );
  });

  it("calls Claude with max_tokens and repository context", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Next.js is a React framework." }]
    });

    const answer = await generateRagAnswer("What is Next.js?", [result], {
      client: { create },
      model: "claude-test"
    });

    expect(answer).toBe("Next.js is a React framework.");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 800,
        model: "claude-test"
      })
    );
    expect(create.mock.calls[0]?.[0].messages[0].content[0].text).toContain("Next.js is a React framework.");
    expect(create.mock.calls[0]?.[0].messages[0].content[0].text).toContain("https://github.com/vercel/next.js");
  });

  it("passes a custom Anthropic base URL when configured", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Answer from configured provider." }]
    });

    await generateRagAnswer("What is this?", [result], {
      apiKey: "test-key",
      baseURL: "https://api.deepseek.com/anthropic"
    });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://api.deepseek.com/anthropic"
    });
  });

  it("fails when Claude does not return text", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "unexpected", input: {} }]
    });

    await expect(generateRagAnswer("Question", [result], { client: { create } })).rejects.toThrow(
      "Claude did not return a text answer."
    );
  });
});

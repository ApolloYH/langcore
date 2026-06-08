import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { analyzeGithubProject } from "./github-analyzer";

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

const validInput = {
  owner: "vercel",
  repo: "next.js",
  description: "The React framework for the web",
  stars: 130000,
  openIssues: 2400,
  closedIssuesLast30Days: 900,
  commitsLast30Days: 700,
  contributorsLast90Days: 250
};

const validAnalysis = {
  health_score: 88,
  activity_level: "high",
  key_metrics: {
    stars_growth_rate: 0.18,
    issue_resolution_rate: 0.74,
    contributor_diversity: 0.82
  },
  risk_factors: ["Large issue backlog"],
  opportunities: ["Strong ecosystem momentum"],
  recommendation: "invest"
};

function toolResponse(input: unknown) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_01",
        name: "record_github_project_analysis",
        input
      }
    ]
  };
}

describe("analyzeGithubProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude with required max_tokens and input_schema tool format", async () => {
    createMock.mockResolvedValueOnce(toolResponse(validAnalysis));

    const result = await analyzeGithubProject(validInput, { apiKey: "test-key" });

    expect(result).toEqual(validAnalysis);
    expect(AnthropicMock).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 1024,
        tool_choice: { type: "tool", name: "record_github_project_analysis" },
        tools: [
          expect.objectContaining({
            input_schema: expect.objectContaining({
              type: "object",
              additionalProperties: false
            })
          })
        ]
      })
    );
    expect(createMock.mock.calls[0]?.[0].tools[0]).not.toHaveProperty("parameters");
  });

  it("accepts boundary values for score, metrics, activity, and recommendation", async () => {
    const boundaryAnalysis = {
      health_score: 0,
      activity_level: "dead",
      key_metrics: {
        stars_growth_rate: 0,
        issue_resolution_rate: 1,
        contributor_diversity: 0
      },
      risk_factors: [],
      opportunities: [],
      recommendation: "avoid"
    };
    createMock.mockResolvedValueOnce(toolResponse(boundaryAnalysis));

    await expect(analyzeGithubProject(validInput, { apiKey: "test-key" })).resolves.toEqual(boundaryAnalysis);
  });

  it("retries retryable Claude errors before returning a valid tool call", async () => {
    createMock
      .mockRejectedValueOnce(Object.assign(new Error("temporary overload"), { status: 500 }))
      .mockResolvedValueOnce(toolResponse(validAnalysis));

    await expect(
      analyzeGithubProject(validInput, {
        apiKey: "test-key",
        retryDelayMs: 0
      })
    ).resolves.toEqual(validAnalysis);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable Claude request errors", async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error("bad request"), { status: 400 }));

    await expect(
      analyzeGithubProject(validInput, {
        apiKey: "test-key",
        retryDelayMs: 0
      })
    ).rejects.toThrow("bad request");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("rejects out-of-range numeric output", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        ...validAnalysis,
        health_score: 101
      })
    );

    await expect(analyzeGithubProject(validInput, { apiKey: "test-key" })).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects uppercase enum values from Claude", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        ...validAnalysis,
        activity_level: "HIGH"
      })
    );

    await expect(analyzeGithubProject(validInput, { apiKey: "test-key" })).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects extra fields returned by Claude", async () => {
    createMock.mockResolvedValueOnce(
      toolResponse({
        ...validAnalysis,
        confidence: 0.9
      })
    );

    await expect(analyzeGithubProject(validInput, { apiKey: "test-key" })).rejects.toBeInstanceOf(ZodError);
  });

  it("fails when Claude skips the required tool call", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Looks healthy." }]
    });

    await expect(analyzeGithubProject(validInput, { apiKey: "test-key" })).rejects.toThrow(
      "Claude did not return the required GitHub analysis tool call."
    );
  });
});

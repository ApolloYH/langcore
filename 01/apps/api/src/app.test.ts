import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app";

const analyzeGithubProjectMock = vi.hoisted(() => vi.fn());

vi.mock("@devscope/ai", () => ({
  analyzeGithubProject: analyzeGithubProjectMock
}));

const validProject = {
  owner: "microsoft",
  repo: "vscode",
  description: "Visual Studio Code",
  stars: 170000,
  openIssues: 7000,
  closedIssuesLast30Days: 1200,
  commitsLast30Days: 900,
  contributorsLast90Days: 300
};

const validAnalysis = {
  health_score: 85,
  activity_level: "high",
  key_metrics: {
    stars_growth_rate: 0.92,
    issue_resolution_rate: 0.15,
    contributor_diversity: 0.7
  },
  risk_factors: ["very high open issue backlog"],
  opportunities: ["massive and active user community"],
  recommendation: "invest"
};

async function buildTestApp() {
  const app = await createApp({ logger: false });
  await app.ready();
  return app;
}

describe("API app", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns health status from the REST health endpoint", async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it("runs github.analyze through tRPC and returns structured JSON", async () => {
    analyzeGithubProjectMock.mockResolvedValueOnce(validAnalysis);
    const app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/trpc/github.analyze",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        project: validProject
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: {
        data: validAnalysis
      }
    });
    expect(analyzeGithubProjectMock).toHaveBeenCalledWith(validProject);
    await app.close();
  });

  it("rejects invalid github.analyze input before calling the AI layer", async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/trpc/github.analyze",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        project: {
          ...validProject,
          owner: ""
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(-32600);
    expect(analyzeGithubProjectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns an API error when the AI layer fails", async () => {
    analyzeGithubProjectMock.mockRejectedValueOnce(new Error("Claude API unavailable"));
    const app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/trpc/github.analyze",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        project: validProject
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain("Claude API unavailable");
    expect(analyzeGithubProjectMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("responds to CORS preflight requests", async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/trpc/github.analyze",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    await app.close();
  });
});

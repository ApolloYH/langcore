import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
const generateEmbeddingMock = vi.hoisted(() => vi.fn());
const getRepositoryDocumentStatsMock = vi.hoisted(() => vi.fn());
const replaceRepositoryDocumentsMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

vi.mock("@devscope/ai", () => ({
  generateEmbedding: generateEmbeddingMock,
  splitTextIntoTokenChunks: (text: string) => [{ chunkIndex: 0, content: text }]
}));

vi.mock("@devscope/db", () => ({
  createPgPool: vi.fn(() => ({ query: vi.fn() })),
  getRepositoryDocumentStats: getRepositoryDocumentStatsMock,
  replaceRepositoryDocuments: replaceRepositoryDocumentsMock
}));

import { EMBEDDING_DIMENSIONS } from "@devscope/shared";

import { ingestGithubRepository } from "./github-pipeline";

function createEmbedding() {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
}

function createOctokit() {
  return {
    repos: {
      get: vi.fn().mockResolvedValue({
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "42"
        },
        data: {
          clone_url: "https://github.com/ApolloYH/EchoCore.git",
          default_branch: "main",
          description: "Meeting assistant based on FunASR",
          forks_count: 0,
          full_name: "ApolloYH/EchoCore",
          html_url: "https://github.com/ApolloYH/EchoCore",
          language: "Python",
          open_issues_count: 0,
          pushed_at: "2026-06-01T00:00:00Z",
          stargazers_count: 4,
          topics: ["asr"],
          watchers_count: 4
        }
      }),
      getReadme: vi.fn().mockResolvedValue({
        data: {
          content: Buffer.from("EchoCore README content").toString("base64"),
          html_url: "https://github.com/ApolloYH/EchoCore/blob/main/README.md",
          path: "README.md"
        }
      })
    },
    git: {
      getTree: vi.fn().mockResolvedValue({
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "41"
        },
        data: {
          tree: [
            { type: "blob", path: "backend/main.py", size: 120 },
            { type: "blob", path: "onnxruntime/third_party/gflags/README.md", size: 200 },
            { type: "blob", path: "node_modules/pkg/index.js", size: 80 },
            { type: "blob", path: "asset/preview.png", size: 100 }
          ]
        }
      })
    }
  };
}

function createFetch() {
  return vi.fn(async (url: URL | string) => {
    const target = String(url);

    if (target.includes("hn.algolia.com")) {
      return {
        ok: true,
        json: async () => ({
          hits: [{ objectID: "123", title: "EchoCore discussion", url: "https://example.com/echocore" }]
        })
      };
    }

    return {
      ok: true,
      text: async () => "from fastapi import FastAPI\napp = FastAPI()"
    };
  }) as unknown as typeof fetch;
}

describe("ingestGithubRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error("git unavailable"));
    });
    generateEmbeddingMock.mockResolvedValue(createEmbedding());
    replaceRepositoryDocumentsMock.mockImplementation((_pool, _owner, _repo, documents) => documents.length);
  });

  it("reuses stored chunks when the GitHub URL has not changed", async () => {
    const octokit = createOctokit();
    getRepositoryDocumentStatsMock.mockResolvedValue({
      chunksStored: 70,
      githubChunks: 4,
      codeChunks: 66,
      hackerNewsChunks: 0
    });

    const result = await ingestGithubRepository(
      {
        githubUrl: "https://github.com/ApolloYH/EchoCore",
        force: false,
        maxHnDiscussions: 5
      },
      {
        logger: { info: vi.fn(), warn: vi.fn() },
        octokit: octokit as any,
        pool: {} as any
      }
    );

    expect(result).toEqual({
      owner: "ApolloYH",
      repo: "EchoCore",
      repositoryUrl: "https://github.com/ApolloYH/EchoCore",
      chunksStored: 70,
      githubChunks: 4,
      codeChunks: 66,
      hackerNewsChunks: 0
    });
    expect(octokit.repos.get).not.toHaveBeenCalled();
    expect(replaceRepositoryDocumentsMock).not.toHaveBeenCalled();
  });

  it("forces a fresh ingest and filters vendored repository files", async () => {
    const octokit = createOctokit();
    getRepositoryDocumentStatsMock.mockResolvedValue({
      chunksStored: 70,
      githubChunks: 4,
      codeChunks: 66,
      hackerNewsChunks: 0
    });

    const result = await ingestGithubRepository(
      {
        githubUrl: "https://github.com/ApolloYH/EchoCore",
        force: true,
        maxHnDiscussions: 1
      },
      {
        fetchImpl: createFetch(),
        logger: { info: vi.fn(), warn: vi.fn() },
        octokit: octokit as any,
        pool: {} as any,
        rateLimitDelayMs: 0
      }
    );

    const storedDocuments = replaceRepositoryDocumentsMock.mock.calls[0]?.[3];

    expect(result).toMatchObject({
      owner: "ApolloYH",
      repo: "EchoCore",
      githubChunks: 2,
      codeChunks: 1,
      hackerNewsChunks: 1
    });
    expect(octokit.repos.get).toHaveBeenCalledWith({ owner: "ApolloYH", repo: "EchoCore" });
    expect(storedDocuments.map((document: { title: string }) => document.title)).toContain("backend/main.py");
    expect(storedDocuments.map((document: { title: string }) => document.title)).not.toContain(
      "onnxruntime/third_party/gflags/README.md"
    );
    expect(storedDocuments.map((document: { title: string }) => document.title)).not.toContain("node_modules/pkg/index.js");
  });

  it("rejects non-GitHub repository URLs before calling Octokit", async () => {
    const octokit = createOctokit();

    await expect(
      ingestGithubRepository(
        {
          githubUrl: "https://gitlab.com/ApolloYH/EchoCore",
          force: false,
          maxHnDiscussions: 5
        },
        {
          octokit: octokit as any,
          pool: {} as any
        }
      )
    ).rejects.toThrow("Invalid GitHub repository URL");

    expect(octokit.repos.get).not.toHaveBeenCalled();
  });
});

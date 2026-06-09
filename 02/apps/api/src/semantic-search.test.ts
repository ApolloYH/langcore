import type { SearchResult } from "@devscope/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rewriteRagQueryMock = vi.hoisted(() => vi.fn());
const generateEmbeddingMock = vi.hoisted(() => vi.fn());
const compressSearchResultsMock = vi.hoisted(() => vi.fn());
const buildCitationsMock = vi.hoisted(() => vi.fn());
const generateRagAnswerMock = vi.hoisted(() => vi.fn());
const searchRepositoryDocumentsMock = vi.hoisted(() => vi.fn());

vi.mock("@devscope/ai", () => ({
  buildCitations: buildCitationsMock,
  compressSearchResults: compressSearchResultsMock,
  generateEmbedding: generateEmbeddingMock,
  generateRagAnswer: generateRagAnswerMock,
  rewriteRagQuery: rewriteRagQueryMock
}));

vi.mock("@devscope/db", () => ({
  createPgPool: vi.fn(() => ({ query: vi.fn() })),
  searchRepositoryDocuments: searchRepositoryDocumentsMock
}));

import { EMBEDDING_DIMENSIONS } from "@devscope/shared";

import { semanticSearch } from "./semantic-search";

const result: SearchResult = {
  id: "chunk-1",
  owner: "ApolloYH",
  repo: "EchoCore",
  sourceType: "github_readme",
  sourceUrl: "https://github.com/ApolloYH/EchoCore",
  title: "README",
  chunkIndex: 0,
  content: "EchoCore supports realtime meeting transcription.",
  score: 0.9,
  vectorScore: 0.8,
  keywordScore: 0.4
};

describe("semanticSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rewriteRagQueryMock.mockResolvedValue("rewritten realtime meeting transcription");
    generateEmbeddingMock.mockResolvedValue(Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1));
    searchRepositoryDocumentsMock.mockResolvedValue([result]);
    compressSearchResultsMock.mockReturnValue([result]);
    buildCitationsMock.mockReturnValue([{ title: "README", sourceType: "github_readme", sourceUrl: result.sourceUrl }]);
    generateRagAnswerMock.mockResolvedValue("EchoCore is a meeting assistant.");
  });

  it("orchestrates query rewriting, embedding search, compression, answer generation, and citations", async () => {
    const response = await semanticSearch(
      {
        owner: "ApolloYH",
        repo: "EchoCore",
        query: "这个项目做什么？",
        limit: 5,
        minSimilarity: 0.1
      },
      {
        pool: {} as any
      }
    );

    expect(rewriteRagQueryMock).toHaveBeenCalledWith("这个项目做什么？");
    expect(generateEmbeddingMock).toHaveBeenCalledWith("rewritten realtime meeting transcription");
    expect(searchRepositoryDocumentsMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        owner: "ApolloYH",
        repo: "EchoCore",
        queryText: "rewritten realtime meeting transcription",
        limit: 5,
        minSimilarity: 0.1
      })
    );
    expect(compressSearchResultsMock).toHaveBeenCalledWith([result], "这个项目做什么？");
    expect(generateRagAnswerMock).toHaveBeenCalledWith("这个项目做什么？", [result]);
    expect(response).toEqual({
      rewrittenQuery: "rewritten realtime meeting transcription",
      answer: "EchoCore is a meeting assistant.",
      citations: [{ title: "README", sourceType: "github_readme", sourceUrl: result.sourceUrl }],
      results: [result]
    });
  });
});

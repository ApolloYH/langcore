import { EMBEDDING_DIMENSIONS } from "@devscope/shared";
import { describe, expect, it, vi } from "vitest";

import { getRepositoryDocumentStats, replaceRepositoryDocuments, searchRepositoryDocuments } from "./vector-store";

function embedding(value = 0.1) {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
}

function createPool(options: { statsRows?: unknown[]; searchRows?: unknown[] } = {}) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes("count(*)::int AS chunks_stored")) {
      return { rows: options.statsRows ?? [] };
    }

    if (sql.includes("WITH ranked_documents AS")) {
      return { rows: options.searchRows ?? [] };
    }

    return { rows: [] };
  });

  const client = {
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn()
  };

  return {
    pool: {
      connect: vi.fn(async () => client),
      query
    },
    client,
    query
  };
}

describe("vector-store", () => {
  it("maps repository document stats from aggregate rows", async () => {
    const { pool } = createPool({
      statsRows: [
        {
          chunks_stored: 7,
          github_chunks: 2,
          code_chunks: 4,
          hacker_news_chunks: 1
        }
      ]
    });

    await expect(getRepositoryDocumentStats(pool as any, "ApolloYH", "EchoCore")).resolves.toEqual({
      chunksStored: 7,
      githubChunks: 2,
      codeChunks: 4,
      hackerNewsChunks: 1
    });
  });

  it("builds hybrid vector and keyword search with owner/repo/similarity filters", async () => {
    const { pool, query } = createPool({
      searchRows: [
        {
          id: "chunk-1",
          owner: "ApolloYH",
          repo: "EchoCore",
          source_type: "github_readme",
          source_url: "https://github.com/ApolloYH/EchoCore",
          title: "README",
          chunk_index: 0,
          content: "EchoCore supports realtime ASR.",
          score: "0.91",
          vector_score: "0.87",
          keyword_score: "0.4"
        }
      ]
    });

    const results = await searchRepositoryDocuments(pool as any, {
      queryEmbedding: embedding(),
      queryText: "Realtime ASR, meetings!",
      owner: "ApolloYH",
      repo: "EchoCore",
      limit: 5,
      minSimilarity: 0.2
    });

    const searchCall = query.mock.calls.find(([sql]) => String(sql).includes("WITH ranked_documents AS"));

    expect(searchCall?.[0]).toContain("owner = $3");
    expect(searchCall?.[0]).toContain("repo = $4");
    expect(searchCall?.[0]).toContain("1 - (embedding <=> $1::vector) >= $5");
    expect(searchCall?.[1]).toEqual([expect.stringMatching(/^\[/), "realtime | asr | meetings", "ApolloYH", "EchoCore", 0.2, 5]);
    expect(results[0]).toMatchObject({
      id: "chunk-1",
      sourceType: "github_readme",
      score: 0.91,
      vectorScore: 0.87,
      keywordScore: 0.4
    });
  });

  it("rolls back document replacement when an embedding has the wrong dimension", async () => {
    const { pool, client } = createPool();

    await expect(
      replaceRepositoryDocuments(pool as any, "ApolloYH", "EchoCore", [
        {
          owner: "ApolloYH",
          repo: "EchoCore",
          sourceType: "github_file",
          sourceUrl: null,
          title: "backend/main.py",
          chunkIndex: 0,
          content: "content",
          embedding: [0.1]
        }
      ])
    ).rejects.toThrow(`Embedding dimension must be ${EMBEDDING_DIMENSIONS}.`);

    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });
});

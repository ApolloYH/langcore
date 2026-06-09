import { beforeEach, describe, expect, it, vi } from "vitest";

const pipelineMock = vi.hoisted(() => vi.fn());
const envMock = vi.hoisted(() => ({ remoteHost: "" }));

vi.mock("@xenova/transformers", () => ({
  env: envMock,
  pipeline: pipelineMock
}));

import { EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL, generateEmbedding, splitTextIntoTokenChunks } from "./embeddings";

describe("embeddings", () => {
  beforeEach(() => {
    pipelineMock.mockResolvedValue(async () => ({
      data: [1, ...Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0)]
    }));
  });

  it("splits text into fixed token chunks", () => {
    const text = Array.from({ length: 1201 }, (_, index) => `token${index}`).join(" ");

    const chunks = splitTextIntoTokenChunks(text);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.content.split(/\s+/)).toHaveLength(500);
    expect(chunks[2]?.content.split(/\s+/)).toHaveLength(201);
  });

  it("uses the local multilingual MiniLM model through a mocked transformer pipeline", async () => {
    const first = await generateEmbedding("Next.js React framework");
    const second = await generateEmbedding("Next.js React framework");
    const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));

    expect(LOCAL_EMBEDDING_MODEL).toBe("Xenova/paraphrase-multilingual-MiniLM-L12-v2");
    expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", LOCAL_EMBEDDING_MODEL);
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(first).toEqual(second);
    expect(magnitude).toBeCloseTo(1, 4);
  });

  it("rejects dimensions that do not match pgvector schema", async () => {
    await expect(generateEmbedding("bge-m3 would be 1024 dimensions", 1024)).rejects.toThrow(
      "Embedding dimension must be 384"
    );
  });
});

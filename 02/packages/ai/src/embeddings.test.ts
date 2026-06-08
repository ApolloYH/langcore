import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, generateEmbedding, splitTextIntoTokenChunks } from "./embeddings";

describe("embeddings", () => {
  it("splits text into fixed token chunks", () => {
    const text = Array.from({ length: 1201 }, (_, index) => `token${index}`).join(" ");

    const chunks = splitTextIntoTokenChunks(text);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.content.split(/\s+/)).toHaveLength(500);
    expect(chunks[2]?.content.split(/\s+/)).toHaveLength(201);
  });

  it("returns a deterministic normalized 1536 dimension embedding", async () => {
    const first = await generateEmbedding("Next.js React framework");
    const second = await generateEmbedding("Next.js React framework");
    const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));

    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(first).toEqual(second);
    expect(magnitude).toBeCloseTo(1, 4);
  });

  it("rejects dimensions that do not match pgvector schema", async () => {
    await expect(generateEmbedding("bge-m3 would be 1024 dimensions", 1024)).rejects.toThrow(
      "Embedding dimension must be 1536"
    );
  });
});

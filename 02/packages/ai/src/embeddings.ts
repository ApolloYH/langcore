import { EMBEDDING_DIMENSIONS } from "@devscope/shared";

export { EMBEDDING_DIMENSIONS };
const DEFAULT_CHUNK_TOKENS = 500;

export interface TextChunk {
  content: string;
  chunkIndex: number;
}

export function splitTextIntoTokenChunks(text: string, chunkTokenSize = DEFAULT_CHUNK_TOKENS): TextChunk[] {
  if (chunkTokenSize < 1) {
    throw new Error("chunkTokenSize must be greater than 0.");
  }

  const tokens = text.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  for (let start = 0; start < tokens.length; start += chunkTokenSize) {
    chunks.push({
      chunkIndex: chunks.length,
      content: tokens.slice(start, start + chunkTokenSize).join(" ")
    });
  }

  return chunks;
}

export async function generateEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): Promise<number[]> {
  if (dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding dimension must be ${EMBEDDING_DIMENSIONS} to match pgvector schema.`);
  }

  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_+#.-]+/g) ?? [];

  for (const token of tokens) {
    const index = hashToken(token) % dimensions;
    vector[index] = (vector[index] ?? 0) + 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function hashToken(token: string) {
  let hash = 2166136261;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

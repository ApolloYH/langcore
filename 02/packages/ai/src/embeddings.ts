import { EMBEDDING_DIMENSIONS } from "@devscope/shared";
import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

export { EMBEDDING_DIMENSIONS };
const DEFAULT_CHUNK_TOKENS = 500;
export const LOCAL_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

env.remoteHost = process.env.TRANSFORMERS_REMOTE_HOST ?? "https://hf-mirror.com";

let embeddingPipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

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

  const extractor = await getEmbeddingPipeline();
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true
  });

  const embedding = Array.from(output.data, (value) => Number(value.toFixed(8)));
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Local embedding model returned ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
  }

  return embedding;
}

async function getEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    embeddingPipelinePromise = pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL) as Promise<FeatureExtractionPipeline>;
  }

  return embeddingPipelinePromise;
}

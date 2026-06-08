import { generateEmbedding, generateRagAnswer } from "@devscope/ai";
import { createPgPool, type PgPool, searchRepositoryDocuments } from "@devscope/db";
import {
  SemanticSearchInputSchema,
  type SemanticSearchInput,
  type SemanticSearchResponse
} from "@devscope/shared";

interface SemanticSearchOptions {
  pool?: PgPool;
}

export async function semanticSearch(
  input: SemanticSearchInput,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResponse> {
  const parsedInput = SemanticSearchInputSchema.parse(input);
  const pool = options.pool ?? createPgPool();
  const queryEmbedding = await generateEmbedding(parsedInput.query);
  const results = await searchRepositoryDocuments(pool, {
    queryEmbedding,
    owner: parsedInput.owner,
    repo: parsedInput.repo,
    limit: parsedInput.limit
  });
  const answer = await generateRagAnswer(parsedInput.query, results);

  return {
    answer,
    results
  };
}

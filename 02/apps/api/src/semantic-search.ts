import { buildCitations, compressSearchResults, generateEmbedding, generateRagAnswer, rewriteRagQuery } from "@devscope/ai";
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
  const rewrittenQuery = await rewriteRagQuery(parsedInput.query);
  const queryEmbedding = await generateEmbedding(rewrittenQuery);
  const results = await searchRepositoryDocuments(pool, {
    queryEmbedding,
    queryText: rewrittenQuery,
    owner: parsedInput.owner,
    repo: parsedInput.repo,
    limit: parsedInput.limit,
    minSimilarity: parsedInput.minSimilarity
  });
  const compressedResults = compressSearchResults(results, parsedInput.query);
  const answer = await generateRagAnswer(parsedInput.query, compressedResults);

  return {
    rewrittenQuery,
    answer,
    citations: buildCitations(compressedResults),
    results
  };
}

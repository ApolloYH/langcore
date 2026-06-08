import { z } from "zod";

export const EMBEDDING_DIMENSIONS = 1536;

export const SourceTypeSchema = z.enum(["github_repo", "github_readme", "hacker_news"]);

export const GithubIngestInputSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    maxHnDiscussions: z.number().int().min(0).max(20).default(5)
  })
  .strict();

export const SemanticSearchInputSchema = z
  .object({
    query: z.string().min(1),
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(10).default(5)
  })
  .strict();

export const SearchResultSchema = z
  .object({
    id: z.string(),
    owner: z.string(),
    repo: z.string(),
    sourceType: SourceTypeSchema,
    sourceUrl: z.string().nullable(),
    title: z.string(),
    chunkIndex: z.number().int().nonnegative(),
    content: z.string(),
    score: z.number()
  })
  .strict();

export const SemanticSearchResponseSchema = z
  .object({
    answer: z.string(),
    results: z.array(SearchResultSchema)
  })
  .strict();

export const GithubIngestResponseSchema = z
  .object({
    owner: z.string(),
    repo: z.string(),
    chunksStored: z.number().int().nonnegative(),
    githubChunks: z.number().int().nonnegative(),
    hackerNewsChunks: z.number().int().nonnegative()
  })
  .strict();

export type SourceType = z.infer<typeof SourceTypeSchema>;
export type GithubIngestInput = z.infer<typeof GithubIngestInputSchema>;
export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SemanticSearchResponse = z.infer<typeof SemanticSearchResponseSchema>;
export type GithubIngestResponse = z.infer<typeof GithubIngestResponseSchema>;

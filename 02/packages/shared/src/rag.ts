import { z } from "zod";

export const EMBEDDING_DIMENSIONS = 384;

export const SourceTypeSchema = z.enum(["github_repo", "github_readme", "github_file", "hacker_news", "local_pdf"]);

export const GithubIngestInputSchema = z
  .object({
    githubUrl: z.string().url().optional(),
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    force: z.boolean().default(false),
    maxHnDiscussions: z.number().int().min(0).max(20).default(5)
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.githubUrl && (!input.owner || !input.repo)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either githubUrl or owner/repo."
      });
    }
  });

export const SemanticSearchInputSchema = z
  .object({
    query: z.string().min(1),
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(10).default(5),
    minSimilarity: z.number().min(0).max(1).default(0)
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
    score: z.number(),
    vectorScore: z.number().optional(),
    keywordScore: z.number().optional()
  })
  .strict();

export const CitationSchema = z
  .object({
    title: z.string(),
    sourceType: SourceTypeSchema,
    sourceUrl: z.string().nullable()
  })
  .strict();

export const SemanticSearchResponseSchema = z
  .object({
    answer: z.string(),
    rewrittenQuery: z.string(),
    citations: z.array(CitationSchema),
    results: z.array(SearchResultSchema)
  })
  .strict();

export const GithubIngestResponseSchema = z
  .object({
    owner: z.string(),
    repo: z.string(),
    repositoryUrl: z.string(),
    chunksStored: z.number().int().nonnegative(),
    githubChunks: z.number().int().nonnegative(),
    codeChunks: z.number().int().nonnegative(),
    hackerNewsChunks: z.number().int().nonnegative()
  })
  .strict();

export const PdfIngestInputSchema = z
  .object({
    filePath: z.string().min(1),
    owner: z.string().min(1).default("local"),
    repo: z.string().min(1).default("thesis")
  })
  .strict();

export const PdfIngestResponseSchema = z
  .object({
    owner: z.string(),
    repo: z.string(),
    filePath: z.string(),
    title: z.string(),
    chunksStored: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative().nullable()
  })
  .strict();

export type SourceType = z.infer<typeof SourceTypeSchema>;
export type GithubIngestInput = z.infer<typeof GithubIngestInputSchema>;
export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type SemanticSearchResponse = z.infer<typeof SemanticSearchResponseSchema>;
export type GithubIngestResponse = z.infer<typeof GithubIngestResponseSchema>;
export type PdfIngestInput = z.infer<typeof PdfIngestInputSchema>;
export type PdfIngestResponse = z.infer<typeof PdfIngestResponseSchema>;

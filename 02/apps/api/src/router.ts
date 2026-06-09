import { initTRPC } from "@trpc/server";
import { z } from "zod";

import { analyzeGithubProject } from "@devscope/ai";
import {
  GithubIngestInputSchema,
  GithubProjectAnalysisInputSchema,
  PdfIngestInputSchema,
  SemanticSearchInputSchema
} from "@devscope/shared";

import { ingestGithubRepository } from "./github-pipeline";
import { ingestPdfDocument } from "./pdf-pipeline";
import { semanticSearch } from "./semantic-search";

const t = initTRPC.create();

export const appRouter = t.router({
  health: t.procedure.query(() => ({ ok: true })),
  github: t.router({
    analyze: t.procedure
      .input(
        z.object({
          project: GithubProjectAnalysisInputSchema
        })
      )
      .mutation(({ input }) => analyzeGithubProject(input.project)),
    ingest: t.procedure.input(GithubIngestInputSchema).mutation(({ input }) => ingestGithubRepository(input))
  }),
  document: t.router({
    ingestPdf: t.procedure.input(PdfIngestInputSchema).mutation(({ input }) => ingestPdfDocument(input))
  }),
  semantic: t.router({
    search: t.procedure.input(SemanticSearchInputSchema).mutation(({ input }) => semanticSearch(input))
  })
});

export type AppRouter = typeof appRouter;

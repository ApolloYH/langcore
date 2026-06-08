import { initTRPC } from "@trpc/server";
import { z } from "zod";

import { analyzeGithubProject } from "@devscope/ai";
import { GithubProjectAnalysisInputSchema } from "@devscope/shared";

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
      .mutation(({ input }) => analyzeGithubProject(input.project))
  })
});

export type AppRouter = typeof appRouter;

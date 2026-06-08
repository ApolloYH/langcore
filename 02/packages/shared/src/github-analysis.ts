import { z } from "zod";

export const ActivityLevelSchema = z.enum(["high", "medium", "low", "dead"]);
export const RecommendationSchema = z.enum(["invest", "watch", "avoid"]);

export const GithubProjectAnalysisInputSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    description: z.string().optional(),
    stars: z.number().int().nonnegative().optional(),
    openIssues: z.number().int().nonnegative().optional(),
    closedIssuesLast30Days: z.number().int().nonnegative().optional(),
    commitsLast30Days: z.number().int().nonnegative().optional(),
    contributorsLast90Days: z.number().int().nonnegative().optional()
  })
  .strict();

export const GithubProjectKeyMetricsSchema = z
  .object({
    stars_growth_rate: z.number().min(0).max(1),
    issue_resolution_rate: z.number().min(0).max(1),
    contributor_diversity: z.number().min(0).max(1)
  })
  .strict();

export const GithubProjectAnalysisSchema = z
  .object({
    health_score: z.number().int().min(0).max(100),
    activity_level: ActivityLevelSchema,
    key_metrics: GithubProjectKeyMetricsSchema,
    risk_factors: z.array(z.string().min(1)).max(10),
    opportunities: z.array(z.string().min(1)).max(10),
    recommendation: RecommendationSchema
  })
  .strict();

export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type GithubProjectAnalysisInput = z.infer<typeof GithubProjectAnalysisInputSchema>;
export type GithubProjectAnalysis = z.infer<typeof GithubProjectAnalysisSchema>;

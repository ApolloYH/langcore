import { integer, jsonb, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "@devscope/shared";

export const repositoryAnalyses = pgTable("repository_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  healthScore: integer("health_score").notNull(),
  activityLevel: text("activity_level").notNull(),
  recommendation: text("recommendation").notNull(),
  keyMetrics: jsonb("key_metrics").notNull(),
  riskFactors: jsonb("risk_factors").notNull(),
  opportunities: jsonb("opportunities").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const repositoryDocuments = pgTable("repository_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  title: text("title").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").notNull(),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

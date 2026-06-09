import { EMBEDDING_DIMENSIONS, type SearchResult, type SourceType } from "@devscope/shared";
import pg from "pg";

export type PgPool = pg.Pool;

export interface RepositoryDocumentInput {
  owner: string;
  repo: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  title: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchInput {
  queryEmbedding: number[];
  queryText?: string;
  owner?: string;
  repo?: string;
  limit: number;
  minSimilarity?: number;
}

export interface RepositoryDocumentStats {
  chunksStored: number;
  githubChunks: number;
  codeChunks: number;
  hackerNewsChunks: number;
}

export function createPgPool(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return new pg.Pool({ connectionString: databaseUrl });
}

export async function ensureVectorSchema(pool: pg.Pool) {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await rebuildRepoEmbeddingsIfDimensionChanged(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repo_embeddings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner text NOT NULL,
      repo text NOT NULL,
      source_type text NOT NULL,
      source_url text,
      title text NOT NULL,
      chunk_index integer NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      embedding vector(${EMBEDDING_DIMENSIONS}) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE repo_embeddings DROP CONSTRAINT IF EXISTS repo_embeddings_source_type_check");
  await pool.query(`
    ALTER TABLE repo_embeddings
    ADD CONSTRAINT repo_embeddings_source_type_check
    CHECK (source_type IN ('github_repo', 'github_readme', 'github_file', 'hacker_news', 'local_pdf'))
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS repo_embeddings_embedding_idx
    ON repo_embeddings
    USING hnsw (embedding vector_cosine_ops)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS repo_embeddings_repo_idx
    ON repo_embeddings (owner, repo)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS repo_embeddings_fts_idx
    ON repo_embeddings
    USING gin (to_tsvector('english', title || ' ' || content))
  `);
}

async function rebuildRepoEmbeddingsIfDimensionChanged(pool: pg.Pool) {
  const { rows } = await pool.query<{ dimensions: number | null }>(`
    SELECT a.atttypmod AS dimensions
    FROM pg_attribute a
    WHERE a.attrelid = 'repo_embeddings'::regclass
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
  `).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("relation \"repo_embeddings\" does not exist")) {
      return { rows: [] };
    }

    throw error;
  });

  const currentDimensions = rows[0]?.dimensions;
  if (typeof currentDimensions === "number" && currentDimensions !== EMBEDDING_DIMENSIONS) {
    await pool.query("DROP TABLE repo_embeddings");
  }
}

export async function replaceRepositoryDocuments(
  pool: pg.Pool,
  owner: string,
  repo: string,
  documents: RepositoryDocumentInput[]
) {
  await ensureVectorSchema(pool);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM repo_embeddings WHERE owner = $1 AND repo = $2", [owner, repo]);

    for (const document of documents) {
      assertEmbeddingDimensions(document.embedding);
      await client.query(
        `
          INSERT INTO repo_embeddings (
            owner, repo, source_type, source_url, title, chunk_index, content, metadata, embedding
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::vector)
        `,
        [
          document.owner,
          document.repo,
          document.sourceType,
          document.sourceUrl,
          document.title,
          document.chunkIndex,
          document.content,
          JSON.stringify(document.metadata ?? {}),
          toVectorLiteral(document.embedding)
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return documents.length;
}

export async function getRepositoryDocumentStats(
  pool: pg.Pool,
  owner: string,
  repo: string
): Promise<RepositoryDocumentStats> {
  await ensureVectorSchema(pool);

  const { rows } = await pool.query<{
    chunks_stored: number;
    github_chunks: number;
    code_chunks: number;
    hacker_news_chunks: number;
  }>(
    `
      SELECT
        count(*)::int AS chunks_stored,
        count(*) FILTER (WHERE source_type IN ('github_repo', 'github_readme'))::int AS github_chunks,
        count(*) FILTER (WHERE source_type = 'github_file')::int AS code_chunks,
        count(*) FILTER (WHERE source_type = 'hacker_news')::int AS hacker_news_chunks
      FROM repo_embeddings
      WHERE owner = $1 AND repo = $2
    `,
    [owner, repo]
  );

  return {
    chunksStored: Number(rows[0]?.chunks_stored ?? 0),
    githubChunks: Number(rows[0]?.github_chunks ?? 0),
    codeChunks: Number(rows[0]?.code_chunks ?? 0),
    hackerNewsChunks: Number(rows[0]?.hacker_news_chunks ?? 0)
  };
}

export async function searchRepositoryDocuments(pool: pg.Pool, input: VectorSearchInput): Promise<SearchResult[]> {
  await ensureVectorSchema(pool);
  assertEmbeddingDimensions(input.queryEmbedding);

  const values: unknown[] = [toVectorLiteral(input.queryEmbedding), toKeywordTsQuery(input.queryText ?? "")];
  const filters = ["embedding IS NOT NULL"];

  if (input.owner) {
    values.push(input.owner);
    filters.push(`owner = $${values.length}`);
  }

  if (input.repo) {
    values.push(input.repo);
    filters.push(`repo = $${values.length}`);
  }

  if (input.minSimilarity && input.minSimilarity > 0) {
    values.push(input.minSimilarity);
    filters.push(`1 - (embedding <=> $1::vector) >= $${values.length}`);
  }

  values.push(input.limit);
  const limitParam = `$${values.length}`;

  const { rows } = await pool.query(
    `
      WITH ranked_documents AS (
        SELECT
          id::text,
          owner,
          repo,
          source_type,
          source_url,
          title,
          chunk_index,
          content,
          1 - (embedding <=> $1::vector) AS vector_score,
          CASE
            WHEN length(trim($2::text)) = 0 THEN 0
            ELSE ts_rank_cd(
              to_tsvector('english', title || ' ' || content),
              to_tsquery('english', $2::text)
            )
          END AS keyword_score
        FROM repo_embeddings
        WHERE ${filters.join(" AND ")}
      )
      SELECT
        *,
        (0.7 * vector_score) + (0.3 * LEAST(keyword_score, 1)) AS score
      FROM ranked_documents
      ORDER BY score DESC, vector_score DESC
      LIMIT ${limitParam}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    title: row.title,
    chunkIndex: row.chunk_index,
    content: row.content,
    score: Number(row.score),
    vectorScore: Number(row.vector_score),
    keywordScore: Number(row.keyword_score)
  }));
}

function assertEmbeddingDimensions(embedding: number[]) {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding dimension must be ${EMBEDDING_DIMENSIONS}.`);
  }
}

function toVectorLiteral(embedding: number[]) {
  return `[${embedding.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function toKeywordTsQuery(query: string) {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(terms)].join(" | ");
}

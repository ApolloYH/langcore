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
  owner?: string;
  repo?: string;
  limit: number;
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repository_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner text NOT NULL,
      repo text NOT NULL,
      source_type text NOT NULL CHECK (source_type IN ('github_repo', 'github_readme', 'hacker_news')),
      source_url text,
      title text NOT NULL,
      chunk_index integer NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      embedding vector(${EMBEDDING_DIMENSIONS}) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS repository_documents_embedding_idx
    ON repository_documents
    USING hnsw (embedding vector_cosine_ops)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS repository_documents_repo_idx
    ON repository_documents (owner, repo)
  `);
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
    await client.query("DELETE FROM repository_documents WHERE owner = $1 AND repo = $2", [owner, repo]);

    for (const document of documents) {
      assertEmbeddingDimensions(document.embedding);
      await client.query(
        `
          INSERT INTO repository_documents (
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

export async function searchRepositoryDocuments(pool: pg.Pool, input: VectorSearchInput): Promise<SearchResult[]> {
  await ensureVectorSchema(pool);
  assertEmbeddingDimensions(input.queryEmbedding);

  const values: unknown[] = [toVectorLiteral(input.queryEmbedding)];
  const filters = ["embedding IS NOT NULL"];

  if (input.owner) {
    values.push(input.owner);
    filters.push(`owner = $${values.length}`);
  }

  if (input.repo) {
    values.push(input.repo);
    filters.push(`repo = $${values.length}`);
  }

  values.push(input.limit);
  const limitParam = `$${values.length}`;

  const { rows } = await pool.query(
    `
      SELECT
        id::text,
        owner,
        repo,
        source_type,
        source_url,
        title,
        chunk_index,
        content,
        1 - (embedding <=> $1::vector) AS score
      FROM repository_documents
      WHERE ${filters.join(" AND ")}
      ORDER BY embedding <=> $1::vector
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
    score: Number(row.score)
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

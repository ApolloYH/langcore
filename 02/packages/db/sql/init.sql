CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repository_documents_embedding_idx
ON repository_documents
USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS repository_documents_repo_idx
ON repository_documents (owner, repo);

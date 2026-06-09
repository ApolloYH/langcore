CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  current_dimensions integer;
BEGIN
  SELECT a.atttypmod
  INTO current_dimensions
  FROM pg_attribute a
  WHERE a.attrelid = 'repo_embeddings'::regclass
    AND a.attname = 'embedding'
    AND NOT a.attisdropped;

  IF current_dimensions IS NOT NULL AND current_dimensions <> 384 THEN
    DROP TABLE repo_embeddings;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

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
  embedding vector(384) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE repo_embeddings DROP CONSTRAINT IF EXISTS repo_embeddings_source_type_check;
ALTER TABLE repo_embeddings
ADD CONSTRAINT repo_embeddings_source_type_check
CHECK (source_type IN ('github_repo', 'github_readme', 'github_file', 'hacker_news', 'local_pdf'));

CREATE INDEX IF NOT EXISTS repo_embeddings_embedding_idx
ON repo_embeddings
USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS repo_embeddings_repo_idx
ON repo_embeddings (owner, repo);

CREATE INDEX IF NOT EXISTS repo_embeddings_fts_idx
ON repo_embeddings
USING gin (to_tsvector('english', title || ' ' || content));

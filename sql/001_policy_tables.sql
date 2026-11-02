-- The policy tables from the guide (section B.3).
-- Safe to run again: every statement uses IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per policy document: one plan, in one country, in one version.
CREATE TABLE IF NOT EXISTS policy_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code      varchar(64) NOT NULL,      -- "GOLD"
  jurisdiction   varchar(8)  NOT NULL,      -- "FR", "US"
  version        varchar(32) NOT NULL,      -- "2026.1"
  title          text        NOT NULL,
  effective_from date        NOT NULL,
  effective_to   date,                      -- null = still in force
  content_hash   varchar(64) NOT NULL,      -- lets ingestion skip a file it has already loaded
  UNIQUE (plan_code, jurisdiction, version)
);

-- Compatibility for databases created before policy_documents.title was added.
ALTER TABLE policy_documents
  ADD COLUMN IF NOT EXISTS title text;

-- One row per chunk of a document, with its embedding.
-- Unlike the guide, chunks don't copy plan_code/jurisdiction: retrieval first picks the
-- ONE document in force for the member's plan, country and date, then searches only its
-- chunks by document_id. That makes "answered from last year's policy" impossible.
CREATE TABLE IF NOT EXISTS policy_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
  chunk_index  int  NOT NULL,
  content      text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',  -- section heading, used in citations
  embedding    vector(768) NOT NULL,         -- 768, not Gemini's default 3072: HNSW allows max 2000
  content_tsv  tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, chunk_index)
);

-- Repair databases created by an earlier schema where embedding was jsonb.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'policy_chunks'
      AND column_name = 'embedding'
      AND udt_name = 'jsonb'
  ) THEN
    ALTER TABLE policy_chunks
      ALTER COLUMN embedding DROP DEFAULT;
    ALTER TABLE policy_chunks
      ALTER COLUMN embedding DROP NOT NULL;
    UPDATE policy_chunks
      SET embedding = NULL;
    ALTER TABLE policy_chunks
      ALTER COLUMN embedding TYPE vector(768)
      USING embedding::text::vector;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS policy_chunks_embedding_idx
  ON policy_chunks USING hnsw (embedding vector_cosine_ops);   -- fast vector (meaning) search
CREATE INDEX IF NOT EXISTS policy_chunks_tsv_idx
  ON policy_chunks USING gin (content_tsv);                    -- fast keyword search
CREATE INDEX IF NOT EXISTS policy_chunks_document_idx
  ON policy_chunks (document_id);

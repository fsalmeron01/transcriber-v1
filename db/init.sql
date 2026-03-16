CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT,
  requested_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  language TEXT,
  raw_text TEXT,
  clean_text TEXT,
  segments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  -- Story classification
  mode TEXT,
  mode_emoji TEXT,
  -- Core article
  headline TEXT,
  subtitle TEXT,
  summary_text TEXT,
  newspack_excerpt TEXT,
  article_draft TEXT,
  key_quotes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- WordPress / Newspack metadata
  categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Yoast SEO block
  yoast_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Scores
  headline_heat_score INTEGER,
  headline_heat_label TEXT,
  seo_strength_score INTEGER,
  legal_risk_level TEXT,
  legal_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Readability
  readability_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Photo guidance
  photo_guidance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_artifacts_job_id ON artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_summaries_job_id ON summaries(job_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transcripts_updated_at ON transcripts;
CREATE TRIGGER trg_transcripts_updated_at
BEFORE UPDATE ON transcripts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_summaries_updated_at ON summaries;
CREATE TRIGGER trg_summaries_updated_at
BEFORE UPDATE ON summaries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

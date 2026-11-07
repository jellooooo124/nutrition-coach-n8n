-- Apply once to a dedicated PostgreSQL database. No destructive migration.
CREATE TABLE IF NOT EXISTS drafts (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('RESERVED','WRITING','RETRYABLE','REVIEW_REQUIRED','DELIVERED')),
  payload BYTEA NOT NULL,
  updated DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS drafts_updated_idx ON drafts (updated DESC);

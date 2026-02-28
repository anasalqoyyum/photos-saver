CREATE TABLE IF NOT EXISTS google_tokens (
  user_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  scope TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_tokens_updated_at
ON google_tokens(updated_at);

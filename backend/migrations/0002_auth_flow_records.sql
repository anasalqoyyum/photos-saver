CREATE TABLE IF NOT EXISTS auth_states (
  state TEXT PRIMARY KEY,
  extension_redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_states_expires_at
ON auth_states(expires_at);

CREATE TABLE IF NOT EXISTS exchange_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_codes_expires_at
ON exchange_codes(expires_at);

CREATE TABLE accounts (
 id TEXT PRIMARY KEY NOT NULL,
 email TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','recorder'))
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (
 key TEXT PRIMARY KEY NOT NULL,
 attempts INTEGER NOT NULL,
 window_start INTEGER NOT NULL
);

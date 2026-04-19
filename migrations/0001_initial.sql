-- ppfarm database schema

CREATE TABLE IF NOT EXISTS users (
  osu_id        INTEGER PRIMARY KEY,
  username      TEXT NOT NULL,
  country_code  TEXT,
  avatar_url    TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  token_expires INTEGER,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  beatmap_id  INTEGER NOT NULL,
  beatmapset_id INTEGER NOT NULL,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  version     TEXT NOT NULL,
  stars       REAL NOT NULL,
  mode        TEXT NOT NULL,
  saved_at    INTEGER NOT NULL,
  UNIQUE(user_id, beatmap_id),
  FOREIGN KEY(user_id) REFERENCES users(osu_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

CREATE TABLE IF NOT EXISTS pp_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  mode        TEXT NOT NULL,
  pp          REAL NOT NULL,
  global_rank INTEGER,
  country_rank INTEGER,
  accuracy    REAL,
  playcount   INTEGER,
  snapshot_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(osu_id)
);

CREATE INDEX IF NOT EXISTS idx_pp_user_mode ON pp_snapshots(user_id, mode, snapshot_at DESC);

-- anonymous aggregate: tracks how many times each map has been recommended
-- used to power the "trending picks" feature
CREATE TABLE IF NOT EXISTS recommendation_counts (
  beatmap_id    INTEGER NOT NULL,
  mode          TEXT NOT NULL,
  strategy      TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  last_updated  INTEGER NOT NULL,
  PRIMARY KEY (beatmap_id, mode, strategy)
);

CREATE INDEX IF NOT EXISTS idx_rec_counts_mode_strategy ON recommendation_counts(mode, strategy, count DESC);

-- cached beatmap metadata (to render trending without re-fetching from osu! every time)
CREATE TABLE IF NOT EXISTS beatmap_cache (
  beatmap_id    INTEGER PRIMARY KEY,
  beatmapset_id INTEGER NOT NULL,
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL,
  creator       TEXT NOT NULL,
  version       TEXT NOT NULL,
  stars         REAL NOT NULL,
  bpm           REAL,
  length        INTEGER,
  mode          TEXT NOT NULL,
  cover_url     TEXT,
  playcount     INTEGER,
  cached_at     INTEGER NOT NULL
);

-- sessions table (simple cookie-based sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(osu_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

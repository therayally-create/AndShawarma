-- &Shawarma — Postgres schema (Vercel/Neon)
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,        -- bcrypt
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
  display_name  TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  disabled      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS shifts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  start       TIME NOT NULL,
  "end"       TIME NOT NULL,
  role        TEXT,                   -- FOH/BOH — class only, never shown in UI
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_date     ON shifts(date);

CREATE TABLE IF NOT EXISTS time_off (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by  TEXT REFERENCES users(id),
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timeoff_user ON time_off(user_id);
CREATE INDEX IF NOT EXISTS idx_timeoff_status ON time_off(status);

CREATE TABLE IF NOT EXISTS swap_requests (
  id              TEXT PRIMARY KEY,
  requester_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id        TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  target_user_id  TEXT REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','approved','denied','cancelled')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_requests (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('time_off','shift_post','shift_take','shift_swap','shift_change')),
  requester_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  shift_id        TEXT,
  target_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  start_date      DATE,
  end_date        DATE,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  action          TEXT,
  before          JSONB,
  after           JSONB,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_requests(status);
CREATE INDEX IF NOT EXISTS idx_pending_requester ON pending_requests(requester_id);

-- Seed users (passwords: ray=ray2026admin, azmeer=admin, badar=admin, staff=staff2026)
-- bcrypt hashes computed at runtime by the seed script — see db/seed.js
-- (do not ship raw bcrypt hashes here; bcrypt is non-deterministic)

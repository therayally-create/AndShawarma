// AndShawarmaDB — single-file SQLite database, lives at ~/Documents/AndShawarmaDB/and-shawarma.db
// Schema, seed data, and helper functions all in one place.

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DB_DIR = path.join(os.homedir(), 'Documents', 'AndShawarmaDB');
const DB_PATH = path.join(DB_DIR, 'and-shawarma.db');

// Ensure the directory exists.
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// One shared connection. better-sqlite3 is synchronous.
let _db = null;
export function db() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  ensureSeed(_db);
  return _db;
}

function initSchema(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
      display_name  TEXT NOT NULL,
      email         TEXT,
      phone         TEXT,
      disabled      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id      TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date    TEXT NOT NULL,
      start   TEXT NOT NULL,
      end     TEXT NOT NULL,
      role    TEXT,
      note    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_shifts_date     ON shifts(date);

    CREATE TABLE IF NOT EXISTS time_off (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      reason      TEXT,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
      decided_by  TEXT REFERENCES users(id),
      decided_at  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_timeoff_user   ON time_off(user_id);
    CREATE INDEX IF NOT EXISTS idx_timeoff_status ON time_off(status);

    CREATE TABLE IF NOT EXISTS swap_requests (
      id              TEXT PRIMARY KEY,
      requester_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_id        TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      target_user_id  TEXT REFERENCES users(id),
      status          TEXT NOT NULL DEFAULT 'open',
      note            TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_requests (
      id              TEXT PRIMARY KEY,
      kind            TEXT NOT NULL,
      requester_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
      shift_id        TEXT,
      target_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
      start_date      TEXT,
      end_date        TEXT,
      reason          TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      action          TEXT,
      before_json     TEXT,
      after_json      TEXT,
      note            TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_status     ON pending_requests(status);
    CREATE INDEX IF NOT EXISTS idx_pending_requester  ON pending_requests(requester_id);
  `);
}

function ensureSeed(d) {
  const row = d.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (row.n > 0) return;
  const users = [
    ['u1','ray',   'ray2026admin', 'admin','Ray Ally',     'theRayally@gmail.com',         '+12624499088'],
    ['u2','azmeer','admin',        'admin','Azmeer',        'azmeer@andshawarma.example',  '+15551234567'],
    ['u3','badar', 'admin',        'admin','Badar Khokar', 'badar@andshawarma.example',   '+15551230003'],
    ['u4','jorge', 'staff2026',    'staff','Jorge',         'jorge@andshawarma.example',   '+15551230004'],
    ['u5','jeremy','staff2026',    'staff','Jeremy',        'jeremy@andshawarma.example',  '+15551230005'],
    ['u6','adnan', 'staff2026',    'staff','Adnan',         'adnan@andshawarma.example',   '+15551230006'],
    ['u7','david', 'staff2026',    'staff','David',         'david@andshawarma.example',   '+15551230007'],
    ['u8','albero','staff2026',    'staff','Albero',        'albero@andshawarma.example',  '+15551230008'],
    ['u9','john',  'staff2026',    'staff','John',          'john@andshawarma.example',    '+15551230009'],
    ['u10','sanaa','staff2026',    'staff','Sanaa',         'sanaa@andshawarma.example',   '+15551230010'],
    ['u11','bhanu','staff2026',    'staff','Bhanu',         'bhanu@andshawarma.example',   '+15551230011'],
  ];
  const ins = d.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name, email, phone, disabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  );
  for (const [id, username, password, role, display_name, email, phone] of users) {
    const hash = bcrypt.hashSync(password, 10);
    ins.run(id, username, hash, role, display_name, email, phone);
  }
  console.log('[AndShawarmaDB] Seeded ' + users.length + ' users into ' + DB_PATH);
}

// ---- Auth ----
export async function hashPassword(plain) { return bcrypt.hash(plain, 10); }
export async function verifyPassword(plain, hash) { return bcrypt.compare(plain, hash || ''); }

export async function signToken(user, expSeconds = 60 * 60 * 24 * 30) {
  const payload = {
    user_id: user.id, username: user.username, role: user.role,
    display_name: user.display_name, exp: Math.floor(Date.now() / 1000) + expSeconds,
  };
  return btoa(JSON.stringify(payload));
}
export async function verifyToken(token) {
  if (!token) return null;
  try {
    const p = JSON.parse(atob(token));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

export async function authUser(request) {
  // Accept either a Web Request (has .headers.get) or an Express req (has .headers plain object).
  let h;
  if (request.headers && typeof request.headers.get === 'function') {
    h = request.headers.get('authorization') || '';
  } else if (request.headers) {
    h = request.headers['authorization'] || request.headers['Authorization'] || '';
  } else {
    return null;
  }
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(m[1]);
}

// Express-style middleware: takes (req, res, next), checks auth, sets req.user.
export function requireAuth(req, res, next) {
  let h;
  if (req.headers && typeof req.headers.get === 'function') {
    h = req.headers.get('authorization') || '';
  } else {
    h = (req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '';
  }
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Unauthorized' });
  verifyToken(m[1]).then(user => {
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  }).catch(err => {
    console.error('[auth] error:', err);
    res.status(500).json({ error: 'Auth error' });
  });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export { DB_PATH, DB_DIR };

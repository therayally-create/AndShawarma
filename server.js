// AndShawarma — standalone API server.
// Run: PORT=3000 node server.js
// Serves /api/* backed by the local SQLite DB at ~/Documents/AndShawarmaDB/and-shawarma.db
// Expose publicly with:  cloudflared tunnel --url http://localhost:3000

import express from 'express';
import { db, requireAuth, verifyPassword, signToken } from './src/lib/server.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Tiny logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`));
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Auth ----
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const u = db().prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u) return res.status(401).json({ error: 'User not found' });
    if (u.disabled) return res.status(403).json({ error: 'Account is disabled. Contact an admin.' });
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    const token = await signToken(u);
    res.json({
      token,
      user: { id: u.id, username: u.username, role: u.role, display_name: u.display_name, email: u.email, phone: u.phone },
    });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const u = db().prepare('SELECT id, username, role, display_name, email, phone FROM users WHERE id = ?').get(req.user.user_id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: u });
});

// ---- Data (single-shot read) ----
app.get('/api/data', requireAuth, (req, res) => {
  try {
    const d = db();
    const users = d.prepare('SELECT id, username, role, display_name, email, phone, disabled FROM users ORDER BY role, display_name').all();
    const shifts = d.prepare('SELECT id, user_id, date, start, end, role, note FROM shifts ORDER BY date, start').all();
    const time_off = d.prepare('SELECT id, user_id, start_date, end_date, reason, status, decided_by, decided_at, created_at FROM time_off ORDER BY created_at DESC').all();
    const swap_requests = d.prepare('SELECT id, requester_id, shift_id, target_user_id, status, note, created_at FROM swap_requests ORDER BY created_at DESC').all();
    const pendingRaw = d.prepare(`
      SELECT id, kind, requester_id, user_id, shift_id, target_user_id,
             start_date, end_date, reason, status, action,
             before_json, after_json, note, created_at, resolved_at
      FROM pending_requests
      WHERE (? IN ('admin','manager') OR requester_id = ?)
      ORDER BY created_at DESC
    `).all(req.user.role, req.user.user_id);
    const pending = pendingRaw.map(p => ({
      ...p,
      before: p.before_json ? JSON.parse(p.before_json) : null,
      after:  p.after_json  ? JSON.parse(p.after_json)  : null,
    }));
    res.json({ users, shifts, time_off, swap_requests, pending });
  } catch (e) {
    console.error('[data]', e);
    res.status(500).json({ error: 'Data load failed: ' + e.message });
  }
});

const allPending = (user) => db().prepare(`
  SELECT id, kind, requester_id, user_id, shift_id, target_user_id,
         start_date, end_date, reason, status, action,
         before_json, after_json, note, created_at, resolved_at
  FROM pending_requests
  WHERE (? IN ('admin','manager') OR requester_id = ?)
  ORDER BY created_at DESC
`).all(user.role, user.user_id).map(p => ({
  ...p, before: p.before_json ? JSON.parse(p.before_json) : null, after: p.after_json ? JSON.parse(p.after_json) : null,
}));

app.get('/api/pending', requireAuth, (req, res) => {
  res.json({ pending: allPending(req.user) });
});

app.post('/api/pending', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    const status = b.kind === 'shift_post' ? 'approved' : (b.status || 'pending');
    db().prepare(`
      INSERT INTO pending_requests
        (id, kind, requester_id, user_id, shift_id, target_user_id,
         start_date, end_date, reason, status, action, before_json, after_json, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, b.kind, b.requester_id || req.user.user_id, b.user_id || null, b.shift_id || null,
      b.target_user_id || null, b.start_date || null, b.end_date || null,
      b.reason || null, status, b.action || null,
      b.before ? JSON.stringify(b.before) : null,
      b.after  ? JSON.stringify(b.after)  : null,
      b.note || null
    );
    res.json({ item: { id }, pending: allPending(req.user) });
  } catch (e) { console.error('[pending POST]', e); res.status(500).json({ error: e.message }); }
});

app.patch('/api/pending/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });
    const { decision } = req.body || {};
    if (!['approved', 'denied'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or denied' });
    const d = db();
    const item = d.prepare('SELECT * FROM pending_requests WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    if (decision === 'approved') {
      if (item.kind === 'time_off') {
        d.prepare(`
          INSERT OR IGNORE INTO time_off (id, user_id, start_date, end_date, reason, status, decided_by, decided_at)
          VALUES (?, ?, ?, ?, ?, 'approved', ?, datetime('now'))
        `).run(item.id, item.requester_id, item.start_date, item.end_date, item.reason, req.user.user_id);
      }
      if (item.kind === 'shift_change' && item.after_json) {
        const a = JSON.parse(item.after_json);
        if (item.action === 'create') {
          d.prepare(`INSERT OR IGNORE INTO shifts (id, user_id, date, start, end, role, note) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(a.id || ('s' + Date.now()), a.user_id, a.date, a.start, a.end, a.role, a.note);
        } else if (item.action === 'delete' && item.before_json) {
          const b = JSON.parse(item.before_json);
          d.prepare('DELETE FROM shifts WHERE id = ?').run(b.id);
        } else if (item.before_json) {
          const b = JSON.parse(item.before_json);
          d.prepare('UPDATE shifts SET user_id=?, date=?, start=?, end=?, role=?, note=? WHERE id=?')
            .run(a.user_id, a.date, a.start, a.end, a.role, a.note, b.id);
        }
      }
    }
    d.prepare(`UPDATE pending_requests SET status=?, resolved_at=datetime('now') WHERE id=?`).run(decision, req.params.id);
    res.json({ pending: allPending(req.user) });
  } catch (e) { console.error('[pending PATCH]', e); res.status(500).json({ error: e.message }); }
});

app.delete('/api/pending/:id', requireAuth, (req, res) => {
  try {
    const d = db();
    const item = d.prepare('SELECT * FROM pending_requests WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.requester_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    d.prepare('DELETE FROM pending_requests WHERE id = ?').run(req.params.id);
    res.json({ pending: allPending(req.user) });
  } catch (e) { console.error('[pending DELETE]', e); res.status(500).json({ error: e.message }); }
});

// ---- Shifts ----
app.get('/api/shifts', requireAuth, (req, res) => {
  res.json({ shifts: db().prepare('SELECT id, user_id, date, start, end, role, note FROM shifts ORDER BY date, start').all() });
});
app.post('/api/shifts', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });
    const b = req.body || {};
    const id = b.id || ('s' + Date.now() + Math.random().toString(36).slice(2, 6));
    db().prepare(`INSERT INTO shifts (id, user_id, date, start, end, role, note) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, b.user_id, b.date, b.start, b.end, b.role || null, b.note || null);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/shifts/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });
    const b = req.body || {};
    const fields = ['user_id','date','start','end','role','note'];
    const sets = [], vals = [];
    for (const f of fields) if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(b[f]); }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields' });
    vals.push(req.params.id);
    db().prepare(`UPDATE shifts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/shifts/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Forbidden' });
    db().prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Time off ----
app.get('/api/timeoff', requireAuth, (req, res) => {
  res.json({ time_off: db().prepare('SELECT id, user_id, start_date, end_date, reason, status, decided_by, decided_at, created_at FROM time_off ORDER BY created_at DESC').all() });
});
app.post('/api/timeoff', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    db().prepare(`
      INSERT INTO pending_requests (id, kind, requester_id, user_id, start_date, end_date, reason, status)
      VALUES (?, 'time_off', ?, ?, ?, ?, ?, 'pending')
    `).run(id, req.user.user_id, req.user.user_id, b.start_date, b.end_date, b.reason || null);
    res.json({ id, kind: 'time_off', status: 'pending' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`\n  &Shawarma API listening on http://localhost:${port}`);
  console.log(`  DB: ~/Documents/AndShawarmaDB/and-shawarma.db\n`);
  console.log(`  To expose to the web:`);
  console.log(`    cloudflared tunnel --url http://localhost:${port}`);
  console.log(`  Then paste that URL into the login page's "API server" field.\n`);
});

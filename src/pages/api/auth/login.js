import { sql, json } from '../_db.js';
import bcrypt from 'bcryptjs';

export const prerender = false;

export async function POST(context) {
  const request = context.request || context;
  const body = await request.json().catch(() => ({}));
  const { username, password } = body || {};
  if (!username || !password) return json({ error: 'Username and password required' }, 400);
  const rows = await sql(
    'SELECT id, username, password_hash, role, display_name, email, phone, disabled FROM users WHERE username = $1',
    [username]
  );
  const u = rows[0];
  if (!u) return json({ error: 'User not found' }, 401);
  if (u.disabled) return json({ error: 'Account is disabled. Contact an admin.' }, 403);
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return json({ error: 'Wrong password' }, 401);
  const payload = {
    user_id: u.id, username: u.username, role: u.role,
    display_name: u.display_name,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  };
  const token = Buffer.from(JSON.stringify(payload)).toString('base64');
  return json({
    token,
    user: { id: u.id, username: u.username, role: u.role, display_name: u.display_name, email: u.email, phone: u.phone },
  });
}

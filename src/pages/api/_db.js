// Shared helpers inlined in each file to avoid Vite import path issues.
import { neon } from '@neondatabase/serverless';

const _neon = neon(process.env.DATABASE_URL);
const sql = _neon.query.bind(_neon);

function json(data, status = 200) {
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

async function getUser(context) {
  const request = context.request || context;
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

async function requireAuth(request) {
  const u = await getUser(request);
  if (!u) return { error: json({ error: 'Unauthorized' }, 401) };
  return { user: u };
}

export { sql, json, getUser, requireAuth };

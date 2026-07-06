// db/seed.js — apply schema and seed users with bcrypt-hashed passwords.
// Run: node db/seed.js  (uses DATABASE_URL from .env.local)

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'fs';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const _neon = neon(url);
const sql = _neon.query.bind(_neon);

const schema = readFileSync('db/schema.sql', 'utf8');
for (const stmt of schema.split(/;\s*$/m).map(s => s.trim()).filter(s => s && !s.startsWith('--'))) {
  if (stmt) await sql(stmt);
}
console.log('Schema applied.');

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

for (const [id, username, password, role, display_name, email, phone] of users) {
  const hash = await bcrypt.hash(password, 10);
  await sql(
    `INSERT INTO users (id, username, password_hash, role, display_name, email, phone, disabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, display_name = EXCLUDED.display_name, email = EXCLUDED.email, phone = EXCLUDED.phone`,
    [id, username, hash, role, display_name, email, phone]
  );
  console.log('Seeded:', username, role);
}

console.log('\nDone. ' + users.length + ' users in DB.');

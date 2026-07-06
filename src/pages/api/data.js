import { sql, json, requireAuth } from './_db.js';

export const prerender = false;

export async function GET(context) {
  const request = context.request || context;
  const a = await requireAuth(request);
  if (a.error) return a.error;
  const [users, shifts, timeOff, swaps, pending] = await Promise.all([
    sql(`SELECT id, username, role, display_name, email, phone, disabled FROM users ORDER BY role, display_name`),
    sql(`SELECT id, user_id, date::text, start::text, "end"::text, role, note FROM shifts ORDER BY date, start`),
    sql(`SELECT id, user_id, start_date::text, end_date::text, reason, status, decided_by, decided_at, created_at::text FROM time_off ORDER BY created_at DESC`),
    sql(`SELECT id, requester_id, shift_id, target_user_id, status, note, created_at::text FROM swap_requests ORDER BY created_at DESC`),
    sql(`SELECT id, kind, requester_id, user_id, shift_id, target_user_id, start_date::text, end_date::text, reason, status, action, before, after, note, created_at::text, resolved_at::text FROM pending_requests ORDER BY created_at DESC`),
  ]);
  return json({ users, shifts, time_off: timeOff, swap_requests: swaps, pending });
}

// Data loader — fetches /data.json (served from public/) and exposes helpers.

import { baseUrl } from './auth.js';

let cache = null;

export async function loadData() {
  if (cache) return cache;
  const res = await fetch(baseUrl('/data.json'));
  if (!res.ok) throw new Error('Failed to load data.json');
  cache = await res.json();
  return cache;
}

export function getUserById(data, id) {
  return data.users.find(u => u.id === id);
}

export function getUserName(data, id) {
  const u = getUserById(data, id);
  return u ? u.display_name : 'Unknown';
}

export function getShiftsForUser(data, userId) {
  return data.shifts
    .filter(s => s.user_id === userId)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function getShiftsForDate(data, date) {
  return data.shifts
    .filter(s => s.date === date)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function getTimeOffForUser(data, userId) {
  return data.time_off
    .filter(t => t.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getAllTimeOff(data) {
  return [...data.time_off].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getSwapsForUser(data, userId) {
  return data.swap_requests
    .filter(sw => sw.requester_id === userId || sw.target_user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function getWeekRange(weekStart) {
  // weekStart: 'YYYY-MM-DD' (Monday). Returns { start, end, days[] }
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), days };
}

export function getMondayOf(date) {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso, opts = {}) {
  const d = new Date(iso + 'T00:00:00');
  if (opts.short) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatDayHeader(iso) {
  const d = new Date(iso + 'T00:00:00');
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: d.getDate(),
    isToday: iso === todayISO(),
  };
}

export function formatTime12(t) {
  // t = 'HH:MM'
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

// &Shawarma shared client code — talks to the local Node/Express API.
// The API base URL is injected at deploy time via window.SHAWARMA_API_URL
// (default: '' → same-origin /api/*).
// All shared functions on window.shawarma.

(function() {
  // Try to discover the API base. Order: window.SHAWARMA_API_URL →
  // localStorage('shawarma.api_url') → meta tag → '' (same origin).
  function discoverApiBase() {
    if (typeof window.SHAWARMA_API_URL === 'string' && window.SHAWARMA_API_URL) {
      return window.SHAWARMA_API_URL.replace(/\/$/, '');
    }
    try {
      const stored = localStorage.getItem('shawarma.api_url');
      if (stored) return stored.replace(/\/$/, '');
    } catch (e) {}
    const meta = document.querySelector('meta[name="shawarma-api-url"]');
    if (meta && meta.content) return meta.content.replace(/\/$/, '');
    return '';
  }
  window.__SHAWARMA_API_BASE = discoverApiBase();
  // Allow user to set it at runtime from the login page if they want.
  window.shawarmaSetApiUrl = function(url) {
    try { localStorage.setItem('shawarma.api_url', url); } catch (e) {}
    window.__SHAWARMA_API_BASE = url.replace(/\/$/, '');
  };
})();

window.shawarma = (function() {
  const TOKEN_KEY = 'shawarma.token';
  const API = (path) => (window.__SHAWARMA_API_BASE || '') + (path.startsWith('/') ? path : '/' + path);

  // ---- API helper ----
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const t = getToken();
    if (t) opts.headers['Authorization'] = 'Bearer ' + t._raw;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API(path), opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      return { ok: false, error: (data && data.error) || ('HTTP ' + res.status) };
    }
    return Object.assign({ ok: true }, data);
  }

  // ---- Token (only thing we keep locally — auth, not data) ----
  function getToken() {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    try {
      const payload = JSON.parse(atob(raw));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      payload._raw = raw;
      return payload;
    } catch { return null; }
  }
  function setToken(raw) { localStorage.setItem(TOKEN_KEY, raw); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }
  function logout() {
    clearToken();
    window.location.href = '/AndShawarma/login/';
  }
  function baseUrl(path) {
    if (!path) return '/';
    if (path.startsWith('/')) return path;
    return '/' + path;
  }
  function requireAuth(roles) {
    const t = getToken();
    if (!t) { window.location.href = baseUrl('/login'); return null; }
    if (roles && roles.indexOf(t.role) === -1) { window.location.href = baseUrl('/'); return null; }
    return t;
  }

  // ---- Data (always live from server — no local cache) ----
  let __dataCache = null;
  let __dataCacheAt = 0;
  const DATA_TTL_MS = 5000; // tiny de-dup window so rapid reads don't pound the API
  async function loadData(opts) {
    opts = opts || {};
    const now = Date.now();
    if (!opts.force && __dataCache && (now - __dataCacheAt) < DATA_TTL_MS) {
      return __dataCache;
    }
    const r = await api('GET', '/api/data');
    if (r.ok) {
      __dataCache = {
        users: r.users || [],
        shifts: r.shifts || [],
        time_off: r.time_off || [],
        swap_requests: r.swap_requests || [],
        pending: r.pending || [],
      };
      __dataCacheAt = now;
      return __dataCache;
    }
    throw new Error('Failed to load data: ' + (r.error || 'unknown'));
  }
  function invalidateData() { __dataCache = null; __dataCacheAt = 0; }

  async function login(username, password) {
    const r = await api('POST', '/api/auth/login', { username, password });
    if (!r.ok) return { ok: false, error: r.error || 'Login failed' };
    if (r.token) setToken(r.token);
    invalidateData();
    return { ok: true, user: r.user };
  }

  // ---- Pending requests (in-memory cache, server is source of truth) ----
  // The cache is hydrated once per page load via refreshPending() and refreshed
  // automatically after every write. Reads are synchronous so existing call sites
  // (s.getPending().filter(...)) keep working without changes.
  let __pendingCache = [];
  let __pendingReady = null; // Promise resolving when first hydration finishes

  function getPending() { return __pendingCache; }
  function setPending(arr) { __pendingCache = arr || []; }
  function clearAllPending() { __pendingCache = []; invalidateData(); }

  // Hydrate the cache from the server. Called on page load and after writes.
  async function refreshPending() {
    const r = await api('GET', '/api/pending');
    if (r.ok && r.pending) __pendingCache = r.pending;
    return __pendingCache;
  }
  // Kick off the initial hydration. Resolves once the first fetch completes.
  function ensurePendingLoaded() {
    if (!__pendingReady) __pendingReady = refreshPending();
    return __pendingReady;
  }

  async function addPending(req) {
    const r = await api('POST', '/api/pending', req);
    invalidateData();
    if (r.ok && r.pending) __pendingCache = r.pending;
    return r.item || req;
  }
  async function resolvePending(id, decision) {
    const r = await api('PATCH', '/api/pending', { id, decision });
    invalidateData();
    if (r.ok && r.pending) __pendingCache = r.pending;
    return r.item || null;
  }
  async function cancelPending(id) {
    const r = await api('DELETE', '/api/pending/' + encodeURIComponent(id));
    invalidateData();
    if (r.ok && r.pending) __pendingCache = r.pending;
    return r.ok;
  }
  function findOrCreate(req) { return req; }
  function submitRequest(req) {
    if (req.kind === 'shift_post') req.status = 'approved';
    return addPending(req);
  }

  // ---- Shift writes ----
  async function updateShift(id, updates) {
    const r = await api('PATCH', '/api/shifts/' + encodeURIComponent(id), updates);
    invalidateData();
    return r;
  }
  async function createShift(shift) {
    const r = await api('POST', '/api/shifts', shift);
    invalidateData();
    return r;
  }
  async function deleteShift(id) {
    const r = await api('DELETE', '/api/shifts/' + encodeURIComponent(id));
    invalidateData();
    return r;
  }
  async function createTimeOff(t) {
    const r = await api('POST', '/api/timeoff', t);
    invalidateData();
    return r;
  }

  // ---- Selectors ----
  function getUserById(d, id) { return d.users.find(u => u.id === id); }
  function getUserName(d, id) { const u = getUserById(d, id); return u ? u.display_name : 'Unknown'; }
  function getShiftsForUser(d, uid) {
    return d.shifts.filter(s => s.user_id === uid)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  function getShiftsForDate(d, date) {
    return d.shifts.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start));
  }
  function getShiftsInRange(d, startISO, endISO) {
    return d.shifts.filter(s => s.date >= startISO && s.date <= endISO)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  function getTimeOffForUser(d, uid) {
    return d.time_off.filter(t => t.user_id === uid)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  function getAllTimeOff(d) {
    return d.time_off.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  function getSwapsForUser(d, uid) {
    return d.swap_requests.filter(sw => sw.requester_id === uid || sw.target_user_id === uid)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  function getTimeOffBlocks(data) {
    const blocks = [];
    if (!data) return blocks;
    function addEntry(p) {
      if (!p.start_date || !p.end_date) return;
      const start = new Date(p.start_date + 'T00:00:00');
      const end = new Date(p.end_date + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        blocks.push({
          date: d.toISOString().slice(0, 10),
          user_id: p.requester_id || p.user_id,
          reason: p.reason || '',
        });
      }
    }
    (data.time_off || []).forEach(addEntry);
    (data.pending || []).forEach(function(p) {
      if (p.kind === 'time_off' && p.status === 'approved') addEntry(p);
    });
    return blocks;
  }
  function isBlocked(blocks, date, userId) {
    return blocks.some(b => b.date === date && b.user_id === userId);
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function getMondayOf(date) {
    const d = new Date(date + 'T00:00:00');
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  function getWeekRange(weekStart) {
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
  function getMonthRange(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10), days, year, month };
  }
  function formatDate(iso, opts) {
    opts = opts || {};
    const d = new Date(iso + 'T00:00:00');
    if (opts.short) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (opts.monthYear) return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function formatDayHeader(iso) {
    const d = new Date(iso + 'T00:00:00');
    return {
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
      day: d.getDate(),
      isToday: iso === todayISO(),
      isOtherMonth: false,
    };
  }
  function formatTime12(t) {
    const parts = t.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return hour + ':' + (m < 10 ? '0' + m : m) + ' ' + period;
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function() { el.classList.remove('show'); }, 2500);
  }
  window.__toast = toast;

  return {
    api, getToken, setToken, clearToken, logout, baseUrl, requireAuth,
    login, loadData, invalidateData,
    getPending, setPending, addPending, resolvePending, cancelPending, findOrCreate, submitRequest, clearAllPending,
    refreshPending, ensurePendingLoaded,
    updateShift, createShift, deleteShift, createTimeOff,
    getUserById, getUserName, getShiftsForUser, getShiftsForDate, getShiftsInRange,
    getTimeOffForUser, getAllTimeOff, getSwapsForUser,
    getTimeOffBlocks, isBlocked,
    todayISO, getMondayOf, getWeekRange, getMonthRange,
    formatDate, formatDayHeader, formatTime12,
    toast,
  };
})();

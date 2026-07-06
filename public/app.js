// &Shawarma shared client code — loaded as a plain <script src> tag.
// No module imports, no bundler. Just functions on window.

window.shawarma = (function() {
  const TOKEN_KEY = 'shawarma.token';

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function getToken() {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    try {
      const payload = JSON.parse(atob(t));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      return payload;
    } catch { return null; }
  }

  function setToken(user) {
    const payload = {
      user_id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    };
    localStorage.setItem(TOKEN_KEY, btoa(JSON.stringify(payload)));
  }

  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  function logout() {
    clearToken();
    window.location.href = '/AndShawarma/login/';
  }

  function baseUrl(path) {
    if (!path) return '/AndShawarma/';
    if (path.startsWith('/')) return '/AndShawarma' + path;
    return '/AndShawarma/' + path;
  }

  function requireAuth(roles) {
    const t = getToken();
    if (!t) { window.location.href = baseUrl('/login'); return null; }
    if (roles && roles.indexOf(t.role) === -1) { window.location.href = baseUrl('/'); return null; }
    return t;
  }

  async function loadData() {
    if (window.__dataCache) return window.__dataCache;
    const res = await fetch(baseUrl('/data.json'));
    if (!res.ok) throw new Error('Failed to load data.json: HTTP ' + res.status);
    window.__dataCache = await res.json();
    return window.__dataCache;
  }

  async function login(username, password, users) {
    const u = users.find(x => x.username === username);
    if (!u) return { ok: false, error: 'User not found' };
    const hash = await sha256(password);
    if (hash !== u.password_hash) return { ok: false, error: 'Wrong password' };
    setToken(u);
    return { ok: true, user: u };
  }

  function getUserById(d, id) { return d.users.find(u => u.id === id); }
  function getUserName(d, id) { const u = getUserById(d, id); return u ? u.display_name : 'Unknown'; }
  function getShiftsForUser(d, uid) {
    return d.shifts.filter(s => s.user_id === uid)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  function getShiftsForDate(d, date) {
    return d.shifts.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start));
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
  function formatDate(iso, opts) {
    opts = opts || {};
    const d = new Date(iso + 'T00:00:00');
    if (opts.short) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function formatDayHeader(iso) {
    const d = new Date(iso + 'T00:00:00');
    return {
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
      day: d.getDate(),
      isToday: iso === todayISO(),
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

  return {
    sha256, getToken, setToken, clearToken, logout, baseUrl, requireAuth,
    loadData, login,
    getUserById, getUserName, getShiftsForUser, getShiftsForDate,
    getTimeOffForUser, getAllTimeOff, getSwapsForUser,
    todayISO, getMondayOf, getWeekRange,
    formatDate, formatDayHeader, formatTime12,
    toast
  };
})();

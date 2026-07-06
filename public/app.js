// &Shawarma shared client code — loaded as a plain <script src> tag.
// No module imports, no bundler. Just functions on window.

window.shawarma = (function() {
  const TOKEN_KEY = 'shawarma.token';
  const PENDING_KEY = 'shawarma.pending';

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

  // Apply approved time-off: keep the staff on their shifts BUT flag the date
  // range as "blocked" so the calendar can render a time-off overlay on top
  // of those days. Returns the set of (date, user_id) blocked ranges.
  function getTimeOffBlocks(data) {
    const blocks = [];
    const approved = getPending().filter(function(p) {
      return p.kind === 'time_off' && p.status === 'approved' && p.start_date && p.end_date;
    });
    approved.forEach(function(p) {
      const start = new Date(p.start_date + 'T00:00:00');
      const end = new Date(p.end_date + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        blocks.push({
          date: d.toISOString().slice(0, 10),
          user_id: p.requester_id,
          reason: p.reason || '',
        });
      }
    });
    return blocks;
  }
  function isBlocked(blocks, date, userId) {
    return blocks.some(function(b) { return b.date === date && b.user_id === userId; });
  }

  async function loadData() {
    if (window.__dataCache) return window.__dataCache;
    const res = await fetch(baseUrl('/data.json'));
    if (!res.ok) throw new Error('Failed to load data.json: HTTP ' + res.status);
    const data = await res.json();
    // Apply approved changes from localStorage (shift takes, deletes, etc.)
    // so the schedule reflects admin-approved swaps.
    const approved = getPending().filter(function(p) { return p.status === 'approved'; });
    for (const p of approved) {
      if (p.kind === 'shift_take' && p.shift_id) {
        const sh = data.shifts.find(function(s) { return s.id === p.shift_id; });
        if (sh) sh.user_id = p.taker_id;
      } else if (p.kind === 'shift_change' && p.action === 'delete' && p.before) {
        data.shifts = data.shifts.filter(function(s) { return s.id !== p.before.id; });
      } else if (p.kind === 'shift_change' && p.action === 'create' && p.after) {
        if (!data.shifts.find(function(s) { return s.id === p.after.shift_id; })) {
          data.shifts.push({
            id: p.after.shift_id,
            user_id: p.after.user_id,
            date: p.after.date,
            start: p.after.start,
            end: p.after.end,
            role: p.after.role,
            notes: p.after.notes || '',
          });
        }
      } else if (p.kind === 'shift_change' && p.action === 'update' && p.after && p.shift_id) {
        const sh = data.shifts.find(function(s) { return s.id === p.shift_id; });
        if (sh) {
          sh.date = p.after.date;
          sh.user_id = p.after.user_id;
          sh.start = p.after.start;
          sh.end = p.after.end;
          sh.role = p.after.role;
          sh.notes = p.after.notes || '';
        }
      } else if (p.kind === 'time_off' && p.start_date && p.end_date) {
        // time-off blocks are computed on the fly via getTimeOffBlocks()
        // — schedule shifts stay intact, the time-off is just rendered
        // as an overlay on the calendar.
      }
    }
    window.__dataCache = data;
    return data;
  }

  async function login(username, password, users) {
    const u = users.find(x => x.username === username);
    if (!u) return { ok: false, error: 'User not found' };
    if (u.disabled) return { ok: false, error: 'Account is disabled. Contact an admin.' };
    const hash = await sha256(password);
    if (hash !== u.password_hash) return { ok: false, error: 'Wrong password' };
    setToken(u);
    return { ok: true, user: u };
  }

  // ---- Pending requests (time-off, swap, shift edits) ----
  // Stored in localStorage; admins see them in their dashboard.
  // Per Ray 2026-07-06: every pending change triggers an email notification
  // to theRayally@gmail.com. Real send is gated by SHAWARMA_PROD=1.
  // For v1 we just log the email body to console + show a toast — the
  // barrier is that there's no backend to deliver the email from.
  function getPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch { return []; }
  }
  function setPending(arr) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
  }
  function findOrCreate(req) {
    const all = getPending();
    // Find existing matching entry (same kind + user + dates)
    const key = (req.kind || '') + '|' + (req.requester_id || req.user_id || '') + '|' + (req.start_date || '') + '|' + (req.end_date || '') + '|' + (req.shift_id || '');
    let existing = null;
    for (let i = 0; i < all.length; i++) {
      const k = (all[i].kind || '') + '|' + (all[i].requester_id || all[i].user_id || '') + '|' + (all[i].start_date || '') + '|' + (all[i].end_date || '') + '|' + (all[i].shift_id || '');
      if (k === key) { existing = all[i]; break; }
    }
    if (existing) {
      // Mutate in place
      Object.assign(existing, req);
      setPending(all);
      return existing;
    } else {
      // Create new
      all.push(req);
      setPending(all);
      return req;
    }
  }
  function addPending(req) {
    const all = getPending();
    req.id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    req.created_at = new Date().toISOString();
    req.status = 'pending';
    all.push(req);
    setPending(all);
    notifyApprovalNeeded(req);
    return req;
  }
  function resolvePending(id, decision) {
    const all = getPending();
    const req = all.find(r => r.id === id);
    if (req) {
      req.status = decision; // 'approved' or 'denied'
      req.resolved_at = new Date().toISOString();
    }
    setPending(all);
    return req;
  }

  // Mock email notification — logs body to console, shows toast.
  // Real implementation: POST to /api/notify with the request payload.
  // The /api/notify endpoint reads SHAWARMA_PROD env to decide real send.
  // Submit a request to the localStorage pending queue.
  // - shift_post: auto-approves (no admin needed to post a shift)
  // - shift_take, shift_change, time_off: stay pending, need admin approval
  function submitRequest(req) {
    const autoApprove = req.kind === 'shift_post';
    if (autoApprove) req.status = 'approved';
    return addPending(req);
  }
  function notifyApprovalNeeded(req) {
    const subject = '[&Shawarma] Approval needed: ' + req.kind;
    const body = [
      'A new request needs your approval.',
      '',
      'Type: ' + req.kind,
      'From: ' + (req.requester_name || req.user_id || 'unknown'),
      'Details: ' + JSON.stringify(req, null, 2),
      '',
      'Approve / deny at: https://therayally-create.github.io/AndShawarma/admin/',
      '',
      '— &Shawarma staff app',
    ].join('\n');
    console.log('[EMAIL → theRayally@gmail.com]');
    console.log('Subject:', subject);
    console.log(body);
    if (typeof window.__toast === 'function') {
      window.__toast('Request submitted — admin notified');
    }
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
    // month: 1-12
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0); // day 0 of next month = last day of this month
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
  // Expose for internal use
  window.__toast = toast;

  return {
    sha256, getToken, setToken, clearToken, logout, baseUrl, requireAuth,
    loadData, login,
    getPending, setPending, addPending, resolvePending, findOrCreate, submitRequest, notifyApprovalNeeded,
    getUserById, getUserName, getShiftsForUser, getShiftsForDate, getShiftsInRange,
    getTimeOffForUser, getAllTimeOff, getSwapsForUser,
    getTimeOffBlocks, isBlocked,
    todayISO, getMondayOf, getWeekRange, getMonthRange,
    formatDate, formatDayHeader, formatTime12,
    toast
  };
})();

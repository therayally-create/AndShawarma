// Auth — SHA-256 password hash check against data.json, token in localStorage.
// All client-side; this is a low-stakes staff tool with trusted-employee access.

const TOKEN_KEY = 'shawarma.token';

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function setToken(user, expSeconds = 60 * 60 * 24 * 30) {
  const payload = {
    user_id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
  };
  const token = btoa(JSON.stringify(payload));
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function getToken() {
  const t = localStorage.getItem(TOKEN_KEY);
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(username, password, users) {
  const u = users.find(x => x.username === username);
  if (!u) return { ok: false, error: 'User not found' };
  const hash = await sha256(password);
  if (hash !== u.password_hash) return { ok: false, error: 'Wrong password' };
  setToken(u);
  return { ok: true, user: u };
}

export function logout() {
  clearToken();
  window.location.href = baseUrl('/login');
}

export function requireAuth(roles = null) {
  const t = getToken();
  if (!t) {
    window.location.href = baseUrl('/login');
    return null;
  }
  if (roles && !roles.includes(t.role)) {
    window.location.href = baseUrl('/');
    return null;
  }
  return t;
}

// Use the current site base (no prefix on Vercel)
export function baseUrl(path) {
  const base = '';
  if (!path) return base + '/';
  if (path.startsWith('/')) return base + path;
  return base + '/' + path;
}

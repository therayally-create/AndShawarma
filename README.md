# &Shawarma — Staff Schedule App

A staff scheduling web app for the &Shawarma restaurant.

## Architecture (one-time read, then forget)

This is a **split deployment**:

- **The website** (HTML/CSS/JS) lives on **GitHub Pages** at
  `https://therayally-create.github.io/AndShawarma/`. It's just static files.
- **The database** lives on **one designated Mac** at
  `~/Documents/AndShawarmaDB/and-shawarma.db` (SQLite). The Mac runs a small
  Node/Express server (`server.js`) on `localhost:3000` that exposes
  `/api/*` endpoints.
- **The tunnel** is **Cloudflare Tunnel** (`cloudflared`). It gives the local
  API a public HTTPS URL (e.g. `https://and-shawarma-db.trycloudflare.com`)
  so the GitHub Pages website can reach it.
- **The user** opens the GitHub Pages URL, pastes the tunnel URL into the
  login screen once, and the rest of the app just works.

The DB is never in the cloud. It sits on the owner's Mac. If the Mac is off
or `server.js` isn't running, the app is read-only down (the website still
loads, but logins fail).

## For the person handing it over

You need:

1. **A Mac to host the database** (the "DB host"). SQLite file lives at
   `~/Documents/AndShawarmaDB/and-shawarma.db`.
2. **A Cloudflare Tunnel** to expose `localhost:3000` as a public URL.
3. **The website** stays on GitHub Pages. The website is **already deployed**
   at https://therayally-create.github.io/AndShawarma/.

The website will *not* change for the person taking over. Only the DB host
+ tunnel changes.

## One-time setup on the DB host (the new owner's Mac)

### 1. Install dependencies

```bash
# Install Node 22 from https://nodejs.org (or `brew install node@22`)
# Install cloudflared:
brew install cloudflared
```

### 2. Copy the database

Copy the entire `AndShawarmaDB/` folder to `~/Documents/AndShawarmaDB/` on
the new machine. This contains the SQLite file with all users, shifts,
time-off, etc.

### 3. Clone the repo (for the server code only — the website is already on GitHub Pages)

```bash
git clone https://github.com/therayally-create/AndShawarma.git
cd AndShawarma
npm install
```

### 4. Start the local API server

```bash
PORT=3000 node server.js
```

You should see:

```
  &Shawarma API listening on http://localhost:3000
  DB: ~/Documents/AndShawarmaDB/and-shawarma.db
```

Leave this running. (Use a process manager like `pm2` or launchd for prod.)

### 5. Start the Cloudflare tunnel

In a second terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare will print a public URL like
`https://random-words-here.trycloudflare.com`. **Copy that URL.** It's
the API URL you'll paste into the login screen.

> **Note:** The free `trycloudflare.com` URLs change every time you restart
> the tunnel. For a stable URL, set up a named Cloudflare Tunnel (free
> account at https://one.dash.cloudflare.com → Zero Trust → Tunnels).

## For users (staff)

1. Open https://therayally-create.github.io/AndShawarma/
2. On the login screen, paste the Cloudflare tunnel URL (the one from step 5
   above) into the **API server** field. The browser remembers it; you only
   have to do this once per device.
3. Log in with your username + password.

### Demo accounts (seeded on first run)

| Username | Password    | Role  | Display name  |
|----------|-------------|-------|---------------|
| `ray`    | `ray2026admin` | admin | Ray Ally     |
| `azmeer` | `admin`     | admin | Azmeer        |
| `badar`  | `admin`     | admin | Badar Khokar  |
| `jorge`  | `staff2026` | staff | Jorge         |
| `jeremy` | `staff2026` | staff | Jeremy        |
| `adnan`  | `staff2026` | staff | Adnan         |
| `david`  | `staff2026` | staff | David         |
| `albero` | `staff2026` | staff | Albero        |
| `john`   | `staff2026` | staff | John          |
| `sanaa`  | `staff2026` | staff | Sanaa         |
| `bhanu`  | `staff2026` | staff | Bhanu         |

## Where the database lives

`~/Documents/AndShawarmaDB/and-shawarma.db` — open it with any SQLite
client (DB Browser for SQLite, `sqlite3` CLI, etc.) to inspect or edit data
directly. **The app will pick up your changes on the next page reload.**

## Backup

```bash
# Hot backup (safe while server is running):
cp ~/Documents/AndShawarmaDB/and-shawarma.db ~/Documents/AndShawarmaDB/and-shawarma.db.bak

# Or use sqlite3:
sqlite3 ~/Documents/AndShawarmaDB/and-shawarma.db ".backup ~/Documents/AndShawarmaDB/and-shawarma.db.bak"
```

## Reset

To wipe everything and re-seed the demo users, just delete the file:

```bash
rm ~/Documents/AndShawarmaDB/and-shawarma.db
# The next time server.js starts, the schema + seed users will be recreated.
```

## File map

```
AndShawarma/
├── server.js                      # The local API server (Express)
├── src/
│   ├── lib/server.js              # DB connection + auth helpers (shared with server.js)
│   ├── layouts/AppLayout.astro    # Header, bottom nav, route guard
│   └── pages/                     # The website (static HTML)
├── public/app.js                  # Shared client code (login, data fetch, etc.)
├── astro.config.mjs               # Static-site build config
├── .github/workflows/deploy.yml   # GitHub Pages deploy on push to main
└── package.json
```

## Authentication

- Tokens are base64-encoded JSON blobs (no real JWT — good enough for a
  trusted-employee app). 30-day expiry, stored in `localStorage`.
- Passwords are hashed with **bcrypt** (10 rounds) in the SQLite users table.
- The `AUTH_SECRET` environment variable is reserved for future HMAC signing
  of tokens but is **not currently set** (the app is fine without it; tokens
  are still cryptographically opaque enough for this use case).

## Environment variables

| Var        | Required | Default                | Purpose |
|------------|----------|------------------------|---------|
| `PORT`     | no       | `3000`                 | Port the API listens on |
| `AUTH_SECRET` | no    | (unset)                | Reserved for future token signing |
| `DATABASE_URL` | no   | (unused)               | Reserved for future Postgres migration |

## Re-deploying the website

```bash
npm run build
git add -A
git commit -m "Your change"
git push origin main
# GitHub Actions deploys to Pages automatically.
```

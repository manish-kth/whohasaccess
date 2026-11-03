# 🔐 WhoHasAccess

**Find out who can access your Google Drive — and revoke the people who shouldn't.**

🕯️ **In memoriam:** the original [whohasaccess.com](https://www.whohasaccess.com/) shut its doors,
but the idea was too good to lose. This is a tribute, a privacy-first, **no-backend** rebuild,
open source and server-free. Thank you to its makers 🙏 Independent and not affiliated.
Everything runs **in your browser**: you authorize Google directly, Drive API calls go
**browser → Google**, and **no server ever sees your token or your files**. No login, no account,
no data stored anywhere. Open source so you can verify all of the above.

**Use it now:** [wha.mkth.dev](https://wha.mkth.dev), or host your own copy (below).

![no backend](https://img.shields.io/badge/backend-none-10b981) ![privacy](https://img.shields.io/badge/reads-metadata%20only-10b981) ![static](https://img.shields.io/badge/deploy-static%20site-2f6bff)

---

## Why it's private by design

| | |
|---|---|
| 🚫🖥️ **No backend** | It's a static web app. Your access token and file list never leave this browser tab. |
| 🔑 **No login** | No account to create. You grant Google access directly; the grant lives only in your browser. |
| ⏳ **Auto-forget** | The authorization is wiped after **1 / 3 / 7 days** of inactivity (your choice) — or instantly, with one click. |
| 🔎 **Metadata only** | Reads file names & sharing settings — **never file contents**. |
| 🔓 **Open source** | Audit the code. There's nowhere for data to hide — there's no server. |

### What it does
- **Scores** your Drive (0–100, A–F) and says exactly what moves the needle.
- **Finds leaks, worst first** — findable on the web, public links, sensitive-looking names shared
  outside, external editors, stale external shares, personal email accounts, domain-wide links,
  expiring access, pending ownership transfers.
- **Fixes them in bulk** — remove, downgrade to viewer, set a 30-day expiry, or make a public link
  unsearchable. Folder-aware: one click on a shared folder covers everything inside. Everything has
  **Undo** (restored silently, no notification emails).
- **Transfers ownership in bulk** — pick files or whole folders and hand them to another account.
  Same-organisation Workspace transfers happen at once; personal accounts get one invite per file,
  and the recipient can accept them all at once from the *Pending ownership* section.
- **Digs in** — people, files and a folder **map** (treemap of where the leaks live), each with
  search, filters and sorting that stay fast at 200k+ items. Drawers show one person's access by
  folder, or one file's people with inherited access traced to its folder.
- **Sharing timeline** per file (optional Drive Activity scope) and, if you opt in, **what changed
  since your last scan**, kept only in this browser.
- Two pools, scanned separately: **files you own** (what you can fix) and **shared with you**.

---

## Quick start (Demo Mode — zero setup)

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and click **"Try the live demo"** — realistic sample data, no Google account needed.

---

## Use it on your real Drive (self-host)

Because there's no backend, the app uses **your own Google OAuth Client ID** (public — **no client
secret**, since nothing server-side ever holds a secret). One-time setup, ~3 minutes:

### 1. Create a Google OAuth Client ID
1. [Google Cloud Console](https://console.cloud.google.com/) → create/pick a project.
2. **APIs & Services → Library** → enable **Google Drive API** (and, optionally, **Drive Activity API**
   for the per-file sharing timeline).
3. **OAuth consent screen** → User type **External** (or **Internal** for Workspace):
   - Fill app name + support email.
   - Add the scope `.../auth/drive` (and `.../auth/drive.activity.readonly` if you enabled Drive Activity).
   - Add **yourself** under **Test users** (required while the app is in "Testing").
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add where you'll run it, e.g. `http://localhost:5173`
     (and your deployed URL later). **No redirect URI needed** for the browser token flow.
   - Copy the **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).

### 2. Give the app your Client ID — two ways
- **Easiest:** run the app, click **"Scan my Google Drive"**, and paste the Client ID when prompted.
  It's stored only in your browser's localStorage.
- **Baked-in (for a hosted build):** copy `.env.example` → `.env` and set `VITE_GOOGLE_CLIENT_ID=...`
  so visitors never have to paste one.

### 3. Scan
Click **"Scan my Google Drive"** → approve Google's consent screen → see your real access report.

> You'll see a **"Google hasn't verified this app"** screen — expected for your own test client.
> **Advanced → Go to WhoHasAccess (unsafe)** to continue. It's your own Client ID, scanning your own Drive.

---

## Deploy it (any static host)

It builds to plain static files — host them anywhere (GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3…).

```bash
npm run build      # outputs to ./dist
```

- Add your deployed origin (e.g. `https://you.github.io`) to the OAuth client's **Authorized JavaScript origins**.
- Deploying under a sub-path (GitHub Pages project site)? Build with the base set:
  ```bash
  VITE_BASE=/whohasaccess/ npm run build
  ```
- Bake in the Client ID for visitors with `VITE_GOOGLE_CLIENT_ID` (see `.env.example`). Leave it empty
  and each visitor pastes their own. A Client ID only works on the origins listed in its OAuth client,
  so it is safe to publish, but use **your own**: someone else's won't sign in on your domain.
- Hosting it for other people? Put your own contact details in `client/public/privacy.html` and
  `client/public/terms.html`.

---

## How it works

```
┌──────────────────────────┐        token (in memory only)      ┌──────────────┐
│  Your browser (static)    │  ────────────────────────────────▶ │ Google OAuth │
│  React + Google Identity  │  ◀──────────────────────────────── │  (GIS)       │
│  Services                 │                                    └──────────────┘
│                           │   files.list · permissions.delete/update/create
│   lib/google.js  ───────────────────────────────────────────▶  Google Drive API
│   lib/analyze.js │  ← exposure levels, score, issues, folder inheritance (in-browser)
│   lib/actions.js │  ← remove / downgrade / expire / link-only, bulk, Undo
│   lib/snapshots.js │ ← optional "what changed" memory (IndexedDB, off by default)
│   lib/session.js │  ← "connected as / last active" marker + auto-forget, theme
└──────────────────────────┘
          ▲
    no server in this picture
```

- **`client/src/lib/google.js`** — Google Identity Services token flow + direct Drive REST calls with
  retry/backoff. The access token lives **only in memory**.
- **`client/src/lib/analyze.js`** — turns files+permissions into exposure levels (private → internal →
  domain → external → public link → findable on the web), the score, the leak lists, people and
  domain aggregates, and traces inherited access back to the folder it comes from.
- **`client/src/lib/actions.js`** — every change to Drive goes through here: bulk runs with progress,
  local apply, Undo.
- **`client/src/lib/sensitive.js`** — file-**name** heuristics (identity, financial, credentials,
  legal/HR, medical, "confidential"…). Contents are never read.

The full threat model, scopes, headers and what the browser keeps are in [`SECURITY.md`](SECURITY.md).

---

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | Build static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

## Notes
- The `drive` scope is requested because **revoking** sharing needs write access; reading alone
  could use `drive.metadata.readonly`.
- Hosting your own instance for other people: while your OAuth app is unverified, Google shows an
  "unverified app" warning and caps sign-ins at 100 accounts. Lifting that needs Google's brand and
  restricted-scope verification (no CASA assessment, because no Drive data reaches a server).

---

## Production deploy (Docker)

The `Dockerfile` builds the site and serves it from a small non-root Caddy on port 8080 with a strict
Content-Security-Policy (`deploy/Caddyfile`) and a `/healthz` endpoint. TLS is left to the reverse
proxy in front.

```bash
docker build -t whohasaccess --build-arg VITE_GOOGLE_CLIENT_ID=<optional client id> .
docker run -d --name whohasaccess -p 8080:8080 whohasaccess
```

`deploy/deploy-docker.sh` does the same with a hardened runtime (read-only filesystem, all
capabilities dropped, no-new-privileges, 128 MB memory cap), bound to `127.0.0.1` or joined to a Docker
network of your choice. Add your proxy's `https://` origin to the OAuth client's **Authorized JavaScript origins**.

## Cloudflare Pages

Auto-deploy from your fork on every push to `main`:

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick your fork.
2. Build command `npm ci && npm run build`, output directory `dist`. Node 22 comes from `.nvmrc`.
3. Environment variable `VITE_GOOGLE_CLIENT_ID` = your Client ID (optional, see above).
4. Add your custom domain under **Custom domains**, and add that `https://` origin to the OAuth client.

Security headers (CSP, HSTS and friends) come from `client/public/_headers`. To publish by hand instead
(Direct Upload), run `deploy/deploy-pages.sh`.

**Netlify / Vercel:** import the repo, build command `npm run build`, publish directory `dist`, same
`VITE_GOOGLE_CLIENT_ID` variable. Copy the headers from `client/public/_headers` into the host's own
headers config (`netlify.toml` / `vercel.json`) so the CSP still applies.

---

❤️ Built with love and a lot of AI. Design, privacy model and stubbornness by a human; most of the typing by Claude; the tests kept both of us honest.

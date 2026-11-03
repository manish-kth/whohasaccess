# Security & privacy model

WhoHasAccess is a static web app. There is no backend, no database and no
account. This document says exactly what runs where, what is kept, and what the
app can and cannot do, so you can check the claims against the code.

## Where things run

| Piece | Where | Code |
|---|---|---|
| Google sign-in (OAuth 2 token flow) | Your browser ↔ `accounts.google.com`, via Google Identity Services | `client/src/lib/google.js` |
| Listing files and permissions | Your browser ↔ `www.googleapis.com` (Drive v3) | `client/src/lib/google.js` |
| Changing sharing (remove, downgrade, expire, link-only) | Your browser ↔ Drive v3 `permissions.*` | `client/src/lib/google.js`, `client/src/lib/actions.js` |
| Sharing timeline (optional) | Your browser ↔ `driveactivity.googleapis.com` | `client/src/lib/google.js` |
| Analysis, scoring, leak detection, sensitive-name heuristics | Your browser, in memory | `client/src/lib/analyze.js`, `client/src/lib/sensitive.js` |
| Serving the static files | Any static host; the reference container is Caddy | `Dockerfile`, `deploy/Caddyfile` |

The static host only ever sees requests for `index.html` and the hashed asset
files. It never sees a token, a file name or a permission.

## The token

- Obtained with the Google Identity Services *token client* (implicit flow,
  public Client ID, no client secret anywhere).
- Kept in a JavaScript variable only. Never written to `localStorage`,
  `sessionStorage`, IndexedDB, cookies or the URL.
- Gone when the tab closes. On reload the app remembers only *who* was
  connected and asks Google for a fresh token when you click Scan.
- **Forget & disconnect** calls Google's revoke endpoint and clears everything
  the browser keeps (see below).
- An inactivity window (1, 3 or 7 days) makes the app forget the connection
  marker on its own.

## Scopes

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/drive` | Read file metadata and permissions, and change sharing. Drive has no narrower scope that can delete a permission. |
| `https://www.googleapis.com/auth/userinfo.email`, `userinfo.profile` | Show who is connected, and tell your own permissions apart from everyone else's. |
| `https://www.googleapis.com/auth/drive.activity.readonly` (optional) | The sharing timeline in a file's drawer. Requested only when you click *Load history*, via incremental consent. |

What is requested from Drive: `files.list` with
`fields=files(id,name,mimeType,parents,owners,ownedByMe,modifiedTime,viewedByMeTime,sharedWithMeTime,webViewLink,capabilities(canShare),permissions(...))`.
File **contents** are never requested. There is no `files.get` with
`alt=media`, no export, no download anywhere in the code.

The "looks sensitive" flag is computed from the **file name only**
(`client/src/lib/sensitive.js`), with a small list of regular expressions
(identity documents, financial, credentials, legal/HR, medical, "confidential",
personal data, infrastructure). It is a hint for prioritising, not a scan of
your data.

## What the browser keeps

| Key | Store | Content | Cleared by |
|---|---|---|---|
| `wha_connection` | localStorage | email, name, picture URL, last-active time, inactivity window. **No token.** | Forget, or the inactivity window |
| `wha_client_id` | localStorage | Your OAuth Client ID (public). Only when you entered one yourself. | Browser site data |
| `wha_theme` | localStorage | `light` / `dark` | Browser site data |
| `wha_ignores` | localStorage | Your ignore list, per account: the ids and names of files, folders or people you marked as intentionally shared. | Forget, or *Clear all* in the Ignored list |
| IndexedDB `wha-scan` (`wha_keep_scan` flag) | IndexedDB | **On by default.** The last scan for each account: file ids, names, types, parents, dates and sharing settings, so a refresh opens the report without a re-scan. Turn off in the privacy menu. | Forget, or turning the option off |
| `wha_keep_snapshots` + IndexedDB `wha` | IndexedDB | **Off by default.** When on: a compact list of shared items (file id, name, who has which role) so the next scan can show what changed. | Forget, or turning the option off |

Nothing else is persisted. With "Keep the last scan" off, the scan lives only
in React state and is gone on reload.

## Changing sharing

- Every change is a direct Drive API call from your browser:
  `permissions.delete`, or `permissions.update` with `role`,
  `expirationTime` or `allowFileDiscovery`.
- Inherited access (someone who can see a file because a parent folder is
  shared with them) is changed on that **folder**, which is how Drive works.
  The UI says so on each row and counts how many items it covers.
- Bulk runs go four at a time, stop at the first error (so a revoked token
  does not produce hundreds of errors), and report how far they got.
- **Undo** re-creates the permission with `permissions.create` and
  `sendNotificationEmail=false`, or reverts the patch. Undo for a removed
  permission produces a new permission id; the UI accounts for that.
- Nothing is ever changed without a click and, for bulk actions, a confirm step.

### Ownership transfer

- Within a Google Workspace organisation the app hands a file over in one
  call: `permissions.create` (or `permissions.update` when the person already
  has access) with `role=owner` and `transferOwnership=true`. Google downgrades
  you to editor. This cannot be undone from the app; the dialog says so and
  asks for an explicit acknowledgement.
- Between personal Google accounts, or across organisations, Google only
  allows an invite: the recipient's permission is created or updated with
  `role=writer` and `pendingOwner=true`. They accept from Google's email, or
  from this app's *Pending ownership* section, which calls `permissions.update`
  with `role=owner` and `transferOwnership=true` from their side. An invite is
  cancelled with `pendingOwner=false`.
- Selecting a folder includes every owned item inside it, because Drive never
  moves a folder's contents with the folder. `moveToNewOwnersRoot` is left off,
  so files stay in their folders.
- `sendNotificationEmail` is never set to `false` on these calls (Google
  refuses it for ownership changes); Google sends its own emails.
- Nothing new is stored: the recipient's address lives only in the dialog.

## Hardening of the served app

`deploy/Caddyfile` sends, on every response:

- `Content-Security-Policy` with `default-src 'none'` and an allow-list that
  names only: this origin, `accounts.google.com/gsi/` (sign-in script, popup
  frame, its stylesheet), `www.googleapis.com` and
  `driveactivity.googleapis.com` (API calls), Google Fonts, and
  `*.googleusercontent.com` for profile photos. `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
  (GIS needs a referrer), `Cross-Origin-Opener-Policy:
  same-origin-allow-popups` (the sign-in popup must be able to talk back),
  `Cross-Origin-Resource-Policy: same-origin`, a restrictive
  `Permissions-Policy`, and no `Server` header.
- The container runs Caddy as a non-root user from a read-only filesystem with
  all capabilities dropped (`deploy/deploy-docker.sh`).

In the app itself:

- Only `https://drive.google.com/...` and `https://docs.google.com/...` links
  from the API are rendered as links (`safeLink` in `analyze.js`); they open
  with `rel="noopener noreferrer"`.
- Profile photos are shown only from `*.googleusercontent.com`, with
  `referrerpolicy="no-referrer"`.
- There is no `dangerouslySetInnerHTML`, no `eval`, no third-party script
  other than Google Identity Services, and no analytics.
- All API calls use `fetch` with the token in the `Authorization` header,
  never in a URL.

## What this app cannot protect you from

- A compromised browser or browser extension can read anything a page can,
  including the token while the tab is open.
- The Google OAuth consent screen is Google's; check that the app name and
  Client ID are the ones you expect before you approve.
- If you self-host and someone else can change the served files, they can
  change the app. Serve it from a host you control, over HTTPS.
- Heuristics are heuristics: a file named innocently can still be sensitive,
  and a file flagged as sensitive may not be.

## Reporting

Use **Report a vulnerability** on the repository's Security tab (a private
advisory). Please do not open a public issue for a vulnerability.

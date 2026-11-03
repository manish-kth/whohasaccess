// Client-side Google auth + Drive REST — everything runs in the browser.
// The access token never leaves this tab; no server is involved.

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]
// Optional, asked for only when the user opens a file's sharing timeline.
export const ACTIVITY_SCOPE = 'https://www.googleapis.com/auth/drive.activity.readonly'

const CLIENT_ID_KEY = 'wha_client_id'

// Token lives ONLY in memory (never persisted). Re-acquired silently on demand.
let accessToken = null
let tokenExpiry = 0
let grantedScopes = new Set()
let tokenClient = null
let pendingReject = null // rejects the in-flight token request, if any

export function getClientId() {
  // Baked-in for a hosted build, or pasted by a self-hoster.
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '').trim()
}
export function setClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, (id || '').trim())
  tokenClient = null // force re-init with the new id
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    let tries = 0
    const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(t)
        resolve()
      } else if (++tries > 120) {
        clearInterval(t)
        reject(new Error('Google sign-in library failed to load (check your network / ad-blocker).'))
      }
    }, 50)
  })
}

async function ensureClient(scopes) {
  await waitForGis()
  const client_id = getClientId()
  if (!client_id) throw new Error('No Google Client ID configured.')
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id,
      scope: scopes.join(' '),
      callback: () => {}, // set per-request below
      // Fires when the popup is closed or blocked, which otherwise leaves the
      // request waiting forever.
      error_callback: (err) => pendingReject?.(new Error(
        err?.type === 'popup_closed' ? 'Google sign-in was closed before finishing.'
          : err?.type === 'popup_failed_to_open' ? 'Google sign-in popup was blocked. Allow popups for this site and try again.'
          : err?.message || 'Google sign-in failed.')),
    })
  }
  return tokenClient
}

// prompt: '' lets Google skip consent if already granted; 'none' = fully silent.
// extraScopes adds to what was granted before (incremental consent).
export async function requestToken({ silent = false, extraScopes = [] } = {}) {
  const scopes = [...new Set([...DRIVE_SCOPES, ...grantedScopes, ...extraScopes])]
  const client = await ensureClient(scopes)
  return new Promise((resolve, reject) => {
    pendingReject = reject
    // A silent request can hang if the browser blocks Google's popup, so give up
    // after a while and let the user retry with a click.
    const timer = silent
      ? setTimeout(() => reject(new Error('Google sign-in timed out. Click Scan to sign in again.')), 15000)
      : null
    client.callback = (resp) => {
      clearTimeout(timer)
      if (resp.error) return reject(new Error(resp.error_description || resp.error))
      accessToken = resp.access_token
      tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000
      grantedScopes = new Set((resp.scope || '').split(' ').filter(Boolean))
      resolve(resp)
    }
    try {
      client.requestAccessToken({
        prompt: silent ? 'none' : '',
        scope: scopes.join(' '),
        include_granted_scopes: true,
      })
    } catch (e) {
      reject(e)
    }
  })
}

export function hasScope(scope) {
  return grantedScopes.has(scope)
}

async function validToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken
  await requestToken({ silent: true })
  return accessToken
}

export function hasLiveToken() {
  return Boolean(accessToken && Date.now() < tokenExpiry)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Fetch with retries. Big Drives hit the per-user rate limit, which comes back
// as 403 (userRateLimitExceeded) or 429; those and 5xx get exponential backoff.
async function apiFetch(url, opts = {}, { retries = 6 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await validToken()
    let res
    try {
      res = await fetch(url, {
        ...opts,
        headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token },
      })
    } catch (e) {
      if (attempt >= retries) throw new Error('Network error talking to Google. Check your connection and try again.')
      await sleep(500 * 2 ** attempt)
      continue
    }
    if (res.status === 204) return null
    if (res.ok) return res.json()

    let body = null
    try { body = await res.json() } catch {}
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || ''
    const msg = body?.error?.message || `Google API error ${res.status}`
    const rateLimited = res.status === 429 || (res.status === 403 && /rate|quota/i.test(reason + msg))
    if ((rateLimited || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After')) * 1000
      await sleep(retryAfter || Math.min(16000, 500 * 2 ** attempt) + Math.random() * 300)
      continue
    }
    if (res.status === 401) {
      accessToken = null // force a silent re-auth next time
      if (attempt < 1) continue
    }
    const err = new Error(msg)
    err.status = res.status
    err.reason = reason
    throw err
  }
}

const DRIVE = 'https://www.googleapis.com/drive/v3'
const driveFetch = (pathAndQuery, opts, retry) => apiFetch(DRIVE + pathAndQuery, opts, retry)

export async function getUserInfo() {
  return apiFetch('https://www.googleapis.com/oauth2/v3/userinfo') // { email, name, picture, ... }
}

// Which part of Drive to scan. "Owned" is what you can actually clean up, and is
// usually far smaller than everything that's been shared with you.
export const SCOPE_QUERY = {
  owned: "'me' in owners and trashed = false",
  shared: "not 'me' in owners and trashed = false",
}

const FILE_FIELDS =
  'nextPageToken,files(id,name,mimeType,webViewLink,createdTime,modifiedTime,viewedByMeTime,sharedWithMeTime,' +
  'ownedByMe,parents,size,' +
  'owners(emailAddress,displayName),sharingUser(emailAddress,displayName),' +
  'capabilities(canShare),linkShareMetadata(securityUpdateEnabled),' +
  'permissions(id,type,role,emailAddress,displayName,domain,photoLink,deleted,expirationTime,' +
  'allowFileDiscovery,pendingOwner,permissionDetails(inherited,inheritedFrom)))'

// Lists one scope page by page. onPage(files) gets each page as it arrives, and
// shouldStop() lets the user end the scan early and keep what's been loaded.
async function listScope(scope, onPage, shouldStop) {
  let pageToken
  do {
    const params = new URLSearchParams({ q: SCOPE_QUERY[scope], corpora: 'user', pageSize: '1000', fields: FILE_FIELDS })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await driveFetch('/files?' + params.toString())
    if (data.files?.length) onPage(data.files)
    pageToken = data.nextPageToken
  } while (pageToken && !shouldStop?.())
}

// scopes: ['owned'] | ['shared'] | ['owned', 'shared'] (both run in parallel).
// onProgress({ owned, shared }) reports running counts per scope.
export async function scanDrive({ scopes = ['owned'], onProgress, shouldStop } = {}) {
  const files = []
  const counts = { owned: 0, shared: 0 }
  await Promise.all(
    scopes.map((scope) =>
      listScope(
        scope,
        (page) => {
          for (const f of page) files.push(f)
          counts[scope] += page.length
          onProgress?.({ ...counts })
        },
        shouldStop
      )
    )
  )
  return files
}

const permPath = (fileId, permissionId) =>
  `/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`

export async function revokePermission(fileId, permissionId) {
  await driveFetch(permPath(fileId, permissionId), { method: 'DELETE' })
}

// Change a permission in place: role ('reader' | 'commenter' | 'writer' |
// 'owner' with query.transferOwnership), expirationTime (ISO string or null to
// clear), allowFileDiscovery (anyone links), pendingOwner (ownership invites).
export async function updatePermission(fileId, permissionId, patch, query = {}) {
  const params = new URLSearchParams({ fields: 'id,role,expirationTime,allowFileDiscovery,pendingOwner', ...query })
  return driveFetch(permPath(fileId, permissionId) + '?' + params.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// Ownership. Within a Google Workspace organisation a file can be handed over
// in one call (role=owner + transferOwnership=true). Between consumer accounts
// Drive only allows an invite: the recipient becomes a writer flagged
// pendingOwner and has to accept (updatePermission with role=owner and
// transferOwnership=true from their side). Drive sends the emails itself and
// refuses sendNotificationEmail=false for ownership calls, so it is not set.
export async function createOwnerPermission(fileId, email, { pending } = {}) {
  const body = pending
    ? { type: 'user', role: 'writer', emailAddress: email, pendingOwner: true }
    : { type: 'user', role: 'owner', emailAddress: email }
  const params = new URLSearchParams({ fields: 'id,role,type,emailAddress,displayName,photoLink,pendingOwner' })
  if (!pending) params.set('transferOwnership', 'true')
  return driveFetch(`/files/${encodeURIComponent(fileId)}/permissions?` + params.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Re-create a permission (used by Undo). No notification email is sent.
export async function createPermission(fileId, perm) {
  const body = { type: perm.type, role: perm.role }
  if (perm.type === 'user' || perm.type === 'group') body.emailAddress = perm.emailAddress
  if (perm.type === 'domain') body.domain = perm.domain
  if (perm.type === 'anyone' || perm.type === 'domain') body.allowFileDiscovery = Boolean(perm.allowFileDiscovery)
  if (perm.expirationTime) body.expirationTime = perm.expirationTime
  const params = new URLSearchParams({ sendNotificationEmail: 'false', fields: 'id,role,type,emailAddress,displayName,domain,photoLink,expirationTime,allowFileDiscovery' })
  return driveFetch(`/files/${encodeURIComponent(fileId)}/permissions?` + params.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Sharing timeline for one file via the Drive Activity API (optional scope).
// Returns [{ at, actorIsMe, added: [perm], removed: [perm] }], newest first.
export async function fileSharingHistory(fileId) {
  if (!hasScope(ACTIVITY_SCOPE)) await requestToken({ extraScopes: [ACTIVITY_SCOPE] })
  const data = await apiFetch('https://driveactivity.googleapis.com/v2/activity:query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemName: `items/${fileId}`,
      filter: 'detail.action_detail_case:PERMISSION_CHANGE',
      pageSize: 50,
    }),
  }, { retries: 2 })
  const who = (p) =>
    p.anyone ? { type: 'anyone' }
      : p.domain ? { type: 'domain', domain: p.domain.name }
      : p.group ? { type: 'group', email: p.group.email }
      : p.user?.knownUser ? { type: 'user', isMe: Boolean(p.user.knownUser.isCurrentUser), id: p.user.knownUser.personName }
      : p.user?.deletedUser ? { type: 'user', deleted: true }
      : { type: 'unknown' }
  return (data?.activities || []).map((a) => {
    const pc = a.primaryActionDetail?.permissionChange || {}
    const at = a.timestamp || a.timeRange?.endTime || null
    return {
      at,
      actorIsMe: (a.actors || []).some((x) => x.user?.knownUser?.isCurrentUser),
      added: (pc.addedPermissions || []).map((p) => ({ role: p.role, ...who(p) })),
      removed: (pc.removedPermissions || []).map((p) => ({ role: p.role, ...who(p) })),
    }
  })
}

// Revoke the token entirely (used by "Forget & disconnect").
export function revokeToken() {
  return new Promise((resolve) => {
    const t = accessToken
    accessToken = null
    tokenExpiry = 0
    tokenClient = null
    grantedScopes = new Set()
    if (t && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(t, () => resolve())
    } else {
      resolve()
    }
  })
}

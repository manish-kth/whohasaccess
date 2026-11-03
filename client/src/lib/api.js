// Client-side facade. Everything runs in the browser — no backend, no login.
// In demo mode every call is answered from mock data with a small delay.

import * as g from './google.js'
import * as s from './session.js'
import { buildMockDrive, mockHistory } from './mockData.js'

let demo = false
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export const api = {
  // ---- config / state ----
  clientIdConfigured: () => Boolean(g.getClientId()),
  getClientId: g.getClientId,
  setClientId: g.setClientId,
  getConnection: s.getConnection,
  isDemo: () => demo,

  // ---- connect (interactive consent) ----
  async connect() {
    demo = false
    await g.requestToken({ silent: false })
    const info = await g.getUserInfo()
    const conn = {
      email: info.email,
      name: info.name,
      picture: info.picture,
      lastActiveAt: Date.now(),
      ttlDays: s.getConnection()?.ttlDays || s.DEFAULT_TTL_DAYS,
    }
    s.setConnection(conn)
    return conn
  },

  // ---- remember who was connected on reload, if within the inactivity window ----
  // No token is requested here: Google's sign-in popup needs a click, so asking at
  // page load just hangs. The token is fetched when the user presses Scan.
  resume() {
    const c = s.getConnection()
    if (!c || s.isExpired(c)) {
      if (c) s.clearConnection()
      return null
    }
    demo = false
    return c
  },

  // ---- demo ----
  startDemo() {
    demo = true
    return { email: 'you@acme.com', name: 'Demo User' }
  },

  // ---- scan ----
  // opts: { scopes: ['owned'] | ['shared'] | ['owned','shared'], onProgress, shouldStop }
  async scan({ scopes = ['owned'], onProgress, shouldStop } = {}) {
    if (demo) {
      const { me, files } = buildMockDrive()
      const want = new Set(scopes)
      const picked = files.filter((f) => want.has(f.ownedByMe ? 'owned' : 'shared'))
      // stream it in a few pages so the scanning screen looks like the real thing
      const counts = { owned: 0, shared: 0 }
      for (let i = 0; i < picked.length; i += 400) {
        await wait(120)
        for (const f of picked.slice(i, i + 400)) counts[f.ownedByMe ? 'owned' : 'shared']++
        onProgress?.({ ...counts })
      }
      return { demo: true, me, scopes, stopped: false, scannedAt: new Date().toISOString(), files: picked }
    }
    const files = await g.scanDrive({ scopes, onProgress, shouldStop })
    const info = await g.getUserInfo()
    s.touch()
    return {
      demo: false,
      me: { emailAddress: info.email, displayName: info.name },
      scopes,
      stopped: Boolean(shouldStop?.()),
      scannedAt: new Date().toISOString(),
      files,
    }
  },

  // ---- fix actions ----
  async revoke(fileId, permissionId) {
    if (demo) { await wait(90); return { ok: true, demo: true } }
    await g.revokePermission(fileId, permissionId)
    s.touch()
    return { ok: true }
  },
  // patch: { role } | { expirationTime } | { allowFileDiscovery }
  async updatePermission(fileId, permissionId, patch) {
    if (demo) { await wait(90); return { ok: true, demo: true, ...patch } }
    const res = await g.updatePermission(fileId, permissionId, patch)
    s.touch()
    return { ok: true, ...res }
  },
  // used by Undo
  async restorePermission(fileId, perm) {
    if (demo) { await wait(90); return { ...perm, id: perm.id || 'perm_' + Math.random().toString(36).slice(2) } }
    const res = await g.createPermission(fileId, perm)
    s.touch()
    return res
  },

  // ---- ownership ----
  // direct: hand over now (Workspace, same organisation). Otherwise send an
  // invite the other person must accept. existingPermissionId: their current
  // permission on the file, if any (then it is updated instead of created).
  async transferOwnership(fileId, { email, existingPermissionId, direct }) {
    if (demo) {
      await wait(90)
      return { id: existingPermissionId || 'perm_' + Math.random().toString(36).slice(2), type: 'user', emailAddress: email, role: direct ? 'owner' : 'writer', pendingOwner: !direct, demo: true }
    }
    const res = existingPermissionId
      ? await g.updatePermission(fileId, existingPermissionId, direct ? { role: 'owner' } : { role: 'writer', pendingOwner: true }, direct ? { transferOwnership: 'true' } : {})
      : await g.createOwnerPermission(fileId, email, { pending: !direct })
    s.touch()
    return { type: 'user', emailAddress: email, ...res, role: direct ? 'owner' : 'writer', pendingOwner: !direct }
  },
  // The signed-in user accepts an ownership invite on a file someone offered them.
  async acceptOwnership(fileId, permissionId) {
    if (demo) { await wait(90); return { ok: true, demo: true } }
    await g.updatePermission(fileId, permissionId, { role: 'owner' }, { transferOwnership: 'true' })
    s.touch()
    return { ok: true }
  },
  // Withdraw an invite you sent (they keep editor access), or send it again.
  async cancelInvite(fileId, permissionId) {
    if (demo) { await wait(90); return { ok: true, demo: true } }
    await g.updatePermission(fileId, permissionId, { pendingOwner: false })
    s.touch()
    return { ok: true }
  },
  async reinvite(fileId, permissionId) {
    if (demo) { await wait(90); return { ok: true, demo: true } }
    await g.updatePermission(fileId, permissionId, { role: 'writer', pendingOwner: true })
    s.touch()
    return { ok: true }
  },

  // ---- sharing timeline (optional Drive Activity scope) ----
  async history(fileId) {
    if (demo) { await wait(250); return mockHistory(fileId) }
    return g.fileSharingHistory(fileId)
  },

  // ---- forget everything ----
  async forget() {
    await g.revokeToken()
    s.clearConnection()
    demo = false
  },

  // ---- inactivity window ----
  setTtlDays: s.setTtlDays,
  ttlDays: s.ttlDays,
  isExpired: s.isExpired,
  msUntilExpiry: s.msUntilExpiry,
}

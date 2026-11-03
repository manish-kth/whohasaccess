// Every change the app makes to Drive goes through here, so there's one place
// for the possible fixes, bulk runs with progress, and Undo.
//
// A target is either one permission on one file, or a "group": the same
// permission on a folder plus every item inside that inherits it. Changing it
// once at the source is what Drive does anyway, so a group costs one API call.

import { api } from './api.js'

export const DAY = 864e5

export const ACTIONS = {
  remove: { label: 'Remove', verb: 'Removed', tone: 'danger', help: 'Take this access away.' },
  downgrade: { label: 'Make viewer', verb: 'Downgraded to viewer', tone: 'warn', help: 'Keep access but stop them editing.' },
  expire: { label: 'Expire in 30 days', verb: 'Set to expire in 30 days', tone: 'warn', help: 'Access ends by itself in 30 days.' },
  restrict: { label: 'Link-only', verb: 'Made link-only', tone: 'warn', help: 'Still open to anyone with the link, but no longer findable in search.' },
  'cancel-invite': { label: 'Cancel invite', verb: 'Cancelled ownership invite', tone: 'warn', help: 'Withdraw the offer. They keep editor access.' },
  'accept-owner': { label: 'Accept ownership', verb: 'Took ownership', tone: 'ok', help: 'Become the owner. The previous owner stays on as editor.' },
}

// Which fixes make sense for a given permission. mine: the permission is the
// signed-in user's own (an ownership invite they can accept).
export function applicableActions(perm, { removable, mine }) {
  if (perm.pendingOwner && mine) return ['accept-owner']
  if (!removable || perm.role === 'owner') return []
  const out = ['remove']
  if (perm.pendingOwner) out.push('cancel-invite')
  if (perm.type === 'anyone') {
    if (perm.allowFileDiscovery) out.push('restrict')
  } else {
    if (perm.role === 'writer' || perm.role === 'fileOrganizer' || perm.role === 'organizer') out.push('downgrade')
    if ((perm.type === 'user' || perm.type === 'group') && !perm.expirationTime) out.push('expire')
  }
  return out
}

const in30 = () => new Date(Date.now() + 30 * DAY).toISOString()

// Normalise an item or a group into { fileId, permissionId, perm, affected }.
export function toTarget(x) {
  if (x.items) {
    return { fileId: x.sourceId, permissionId: x.permissionId, perm: x.perm, name: x.name,
      affected: x.items.map((i) => ({ fileId: i.fileId, permissionId: i.permissionId })) }
  }
  return { fileId: x.fileId, permissionId: x.permissionId, perm: x.perm, name: x.name,
    affected: [{ fileId: x.fileId, permissionId: x.permissionId }] }
}

// Runs one action on one target. Returns { change, undo } where change is applied
// to the local scan and undo knows how to put things back.
export async function runAction(action, target) {
  const t = target.affected ? target : toTarget(target)
  const label = `${ACTIONS[action].verb}: ${t.name}`
  if (action === 'accept-owner') {
    await api.acceptOwnership(t.fileId, t.permissionId)
    // No undo: only the new owner can hand it back.
    return { change: { type: 'accept', fileId: t.fileId, permissionId: t.permissionId, affected: t.affected }, undo: null }
  }
  if (action === 'cancel-invite') {
    await api.cancelInvite(t.fileId, t.permissionId)
    return {
      change: { type: 'patch', affected: t.affected, patch: { pendingOwner: false } },
      undo: { label, run: async () => {
        await api.reinvite(t.fileId, t.permissionId)
        return { type: 'patch', affected: t.affected, patch: { role: 'writer', pendingOwner: true } }
      } },
    }
  }
  if (action === 'remove') {
    await api.revoke(t.fileId, t.permissionId)
    return {
      change: { type: 'remove', affected: t.affected },
      undo: { label, run: async () => {
        const created = await api.restorePermission(t.fileId, t.perm)
        const newId = created?.id || t.permissionId
        return { type: 'restore', fileId: t.fileId, perm: { ...t.perm, id: newId },
          affected: t.affected.map((a) => ({ fileId: a.fileId, permissionId: newId })) }
      } },
    }
  }
  const patch = action === 'downgrade' ? { role: 'reader' }
    : action === 'expire' ? { expirationTime: in30() }
    : action === 'restrict' ? { allowFileDiscovery: false }
    : null
  if (!patch) throw new Error('Unknown action ' + action)
  const prev = action === 'downgrade' ? { role: t.perm.role }
    : action === 'expire' ? { expirationTime: t.perm.expirationTime || null }
    : { allowFileDiscovery: Boolean(t.perm.allowFileDiscovery) }
  await api.updatePermission(t.fileId, t.permissionId, patch)
  return {
    change: { type: 'patch', affected: t.affected, patch },
    undo: { label, run: async () => {
      await api.updatePermission(t.fileId, t.permissionId, prev)
      return { type: 'patch', affected: t.affected, patch: prev }
    } },
  }
}

// Runs an action on many targets, a few at a time, reporting progress. Stops at
// the first failure (so a revoked token doesn't produce a hundred errors) but
// keeps everything done so far.
export async function runBulk(action, targets, { concurrency = 4, onProgress, shouldStop } = {}) {
  const queue = [...targets]
  const total = queue.length
  const changes = []
  const undos = []
  let done = 0
  let failed = null
  async function worker() {
    while (queue.length && !failed && !shouldStop?.()) {
      const t = queue.shift()
      try {
        const r = await runAction(action, t)
        changes.push(r.change); if (r.undo) undos.push(r.undo)
        done++
        if (done % 10 === 0 || done === total) onProgress?.({ done, total })
      } catch (e) { failed = e }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  return { done, total, changes, undos, failed }
}

// Hands a set of files over to one person. Unlike runBulk this keeps going past
// a file Google refuses (wrong type, no quota, already owned by them...) and
// reports every failure, because one bad file shouldn't stop a 400-file move.
// Stops only on an expired token (401), a user Stop, or 25 failures in a row.
// files: [{ id, name, permissions }]. me: { emailAddress } of the signed-in user.
export async function runTransfer(files, { email, direct, me }, { concurrency = 3, onProgress, shouldStop } = {}) {
  const to = (email || '').trim().toLowerCase()
  const queue = [...files]
  const total = queue.length
  const changes = []
  const failures = []
  let done = 0
  let halted = null
  let streak = 0
  async function worker() {
    while (queue.length && !halted && !shouldStop?.()) {
      const f = queue.shift()
      const existing = (f.permissions || []).find((p) => !p.deleted && p.type === 'user' && (p.emailAddress || '').toLowerCase() === to)
      try {
        const perm = await api.transferOwnership(f.id, { email: to, existingPermissionId: existing?.id, direct })
        changes.push(direct
          ? { type: 'transfer', fileId: f.id, email: to, perm, me, affected: [{ fileId: f.id, permissionId: perm.id }] }
          : { type: 'invite', fileId: f.id, email: to, perm, affected: [{ fileId: f.id, permissionId: perm.id }] })
        done++
        streak = 0
      } catch (e) {
        failures.push({ fileId: f.id, name: f.name, message: e.message || String(e) })
        if (e.status === 401 || ++streak >= 25) halted = e
      }
      if ((done + failures.length) % 5 === 0 || done + failures.length === total) onProgress?.({ done, failed: failures.length, total, changes })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  return { done, total, changes, failures, stopped: Boolean(halted || (queue.length && shouldStop?.())), halted }
}

const sameEmail = (p, email) => p.type === 'user' && (p.emailAddress || '').toLowerCase() === (email || '').toLowerCase()

// Applies local changes to the scan so the UI updates without a re-scan.
export function applyChanges(scan, changes) {
  if (!changes.length) return scan
  const byFile = new Map()
  for (const c of changes) {
    for (const a of c.affected) {
      if (!byFile.has(a.fileId)) byFile.set(a.fileId, [])
      byFile.get(a.fileId).push({ ...c, permissionId: a.permissionId })
    }
  }
  const myEmail = (scan.me?.emailAddress || '').toLowerCase()
  return {
    ...scan,
    files: scan.files.map((f) => {
      const ops = byFile.get(f.id)
      if (!ops) return f
      let perms = f.permissions || []
      let patch = null
      for (const op of ops) {
        if (op.type === 'remove') perms = perms.filter((p) => p.id !== op.permissionId)
        else if (op.type === 'patch') perms = perms.map((p) => (p.id === op.permissionId ? { ...p, ...op.patch } : p))
        else if (op.type === 'restore') perms = perms.some((p) => p.id === op.perm.id) ? perms : [...perms, op.perm]
        else if (op.type === 'invite') {
          const np = { ...op.perm, type: 'user', role: 'writer', pendingOwner: true, emailAddress: op.perm.emailAddress || op.email }
          perms = perms.some((p) => p.id === np.id || sameEmail(p, op.email)) ? perms.map((p) => (p.id === np.id || sameEmail(p, op.email) ? { ...p, ...np } : p)) : [...perms, np]
        } else if (op.type === 'transfer') {
          // I become an editor, they become the owner, the file leaves my pool.
          const np = { ...op.perm, type: 'user', role: 'owner', pendingOwner: false, emailAddress: op.perm.emailAddress || op.email }
          perms = perms.map((p) => (p.role === 'owner' && sameEmail(p, myEmail) ? { ...p, role: 'writer' } : p))
          perms = perms.some((p) => p.id === np.id || sameEmail(p, op.email)) ? perms.map((p) => (p.id === np.id || sameEmail(p, op.email) ? { ...p, ...np } : p)) : [...perms, np]
          patch = { ownedByMe: false, owners: [{ emailAddress: op.email, displayName: op.perm.displayName || op.email }] }
        } else if (op.type === 'accept') {
          // The reverse: I become the owner, the previous owner stays on as editor.
          perms = perms.map((p) => (p.role === 'owner' ? { ...p, role: 'writer' } : p.id === op.permissionId ? { ...p, role: 'owner', pendingOwner: false } : p))
          patch = { ownedByMe: true, owners: [{ emailAddress: scan.me?.emailAddress, displayName: scan.me?.displayName }], capabilities: { ...(f.capabilities || {}), canShare: true } }
        }
      }
      return { ...f, ...(patch || {}), permissions: perms }
    }),
  }
}

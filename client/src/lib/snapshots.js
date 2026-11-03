// Optional "what changed since last time" memory. Off by default. When the user
// turns it on, a compact summary of every SHARED file (id, name, who has what
// role) is kept in this browser's IndexedDB so the next scan can show new shares,
// new people and newly public files. "Forget & disconnect" wipes it.

const DB = 'wha'
const STORE = 'snapshots'
const FLAG = 'wha_keep_snapshots'
const KEEP = 5

export function snapshotsEnabled() {
  try { return localStorage.getItem(FLAG) === '1' } catch { return false }
}
export function setSnapshotsEnabled(on) {
  try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG) } catch {}
  if (!on) clearSnapshots().catch(() => {})
}

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const out = fn(store)
    t.oncomplete = () => resolve(out?.result ?? out)
    t.onerror = () => reject(t.error)
  })
}

// Compact form: only files shared with someone else, keyed per account + scope.
function compact(analysis) {
  const entries = []
  for (const f of analysis.files) {
    if (!f._others) continue
    entries.push([f.id, f.name, f._items.filter((i) => i.role !== 'owner').map((i) => `${i.personKey}|${i.role}`)])
  }
  return entries
}

export async function saveSnapshot(analysis) {
  if (!snapshotsEnabled()) return null
  const db = await open()
  const id = `${analysis.me?.emailAddress || 'me'}|${analysis.scope}|${Date.now()}`
  const snap = { id, email: analysis.me?.emailAddress, scope: analysis.scope, at: analysis.scannedAt, score: analysis.score.value, totals: analysis.totals, entries: compact(analysis) }
  await tx(db, 'readwrite', (s) => s.put(snap))
  // keep only the newest few for this account+scope
  const all = await tx(db, 'readonly', (s) => s.getAll())
  const mine = all.filter((x) => x.email === snap.email && x.scope === snap.scope).sort((a, b) => (a.at < b.at ? 1 : -1))
  for (const old of mine.slice(KEEP)) await tx(db, 'readwrite', (s) => s.delete(old.id))
  db.close()
  return snap
}

export async function listSnapshots(email, scope) {
  try {
    const db = await open()
    const all = await tx(db, 'readonly', (s) => s.getAll())
    db.close()
    return all.filter((x) => x.email === email && x.scope === scope).sort((a, b) => (a.at < b.at ? 1 : -1))
  } catch { return [] }
}

export async function clearSnapshots() {
  const db = await open()
  await tx(db, 'readwrite', (s) => s.clear())
  db.close()
}

// Diff the current analysis against the previous snapshot (not the one just saved).
export function diffSnapshot(analysis, prev) {
  if (!prev) return null
  const before = new Map(prev.entries.map(([id, name, perms]) => [id, { name, perms: new Set(perms) }]))
  const now = new Map(compact(analysis).map(([id, name, perms]) => [id, { name, perms: new Set(perms) }]))
  const newShares = [] // { fileId, name, who, role }
  const removedShares = []
  const newPeople = new Set()
  const peopleBefore = new Set()
  for (const { perms } of before.values()) for (const p of perms) peopleBefore.add(p.split('|')[0])
  let newlyPublic = 0
  for (const [id, cur] of now) {
    const old = before.get(id)
    for (const p of cur.perms) {
      if (!old || !old.perms.has(p)) {
        const [who, role] = p.split('|')
        newShares.push({ fileId: id, name: cur.name, who, role })
        if (!peopleBefore.has(who)) newPeople.add(who)
        if (who === '__anyone__' && !(old && [...old.perms].some((x) => x.startsWith('__anyone__|')))) newlyPublic++
      }
    }
  }
  for (const [id, old] of before) {
    const cur = now.get(id)
    for (const p of old.perms) {
      if (!cur || !cur.perms.has(p)) {
        const [who, role] = p.split('|')
        removedShares.push({ fileId: id, name: old.name, who, role })
      }
    }
  }
  return { since: prev.at, prevScore: prev.score, newShares, removedShares, newPeople: [...newPeople], newlyPublic }
}

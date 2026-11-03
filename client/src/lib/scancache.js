// Keeps the last scan in this browser's IndexedDB so a refresh opens the report
// straight away and a re-scan is something the user asks for. On by default;
// can be turned off in the privacy menu. Demo scans are never kept. Forget
// wipes it. There is no server: this is the only copy anywhere.

const DB = 'wha-scan'
const STORE = 'scans'
const FLAG = 'wha_keep_scan'

export function keepScanEnabled() {
  try { return localStorage.getItem(FLAG) !== '0' } catch { return true }
}
export function setKeepScan(on) {
  try { on ? localStorage.removeItem(FLAG) : localStorage.setItem(FLAG, '0') } catch {}
  if (!on) clearScans().catch(() => {})
}

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'email' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

// Drop the analysis fields (they start with "_") so only Drive data is stored.
const clean = (f) => { const o = {}; for (const k in f) if (k[0] !== '_') o[k] = f[k]; return o }

export async function saveScan(scan) {
  if (!keepScanEnabled() || !scan || scan.demo) return false
  const email = (scan.me?.emailAddress || '').toLowerCase()
  if (!email) return false
  const db = await open()
  await tx(db, 'readwrite', (s) => s.put({
    email, savedAt: Date.now(),
    scan: { me: scan.me, scopes: scan.scopes, stopped: scan.stopped, scannedAt: scan.scannedAt, demo: false, files: scan.files.map(clean) },
  }))
  db.close()
  return true
}

export async function loadScan(email) {
  if (!keepScanEnabled() || !email) return null
  try {
    const db = await open()
    const rec = await tx(db, 'readonly', (s) => s.get(email.toLowerCase()))
    db.close()
    return rec?.scan?.files ? { ...rec.scan, cached: true, savedAt: rec.savedAt } : null
  } catch { return null }
}

export async function clearScans() {
  try { const db = await open(); await tx(db, 'readwrite', (s) => s.clear()); db.close() } catch {}
}

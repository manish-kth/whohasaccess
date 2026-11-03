// Things the user has marked as intentionally shared. Kept per account in this
// browser's localStorage: the key, a label for the list, and when it was added.
// No token, no contents. Ignored shares are left out of the leak lists and the
// score but stay visible in People / Files, tagged "ignored". Wiped by Forget.

const KEY = 'wha_ignores'
const acct = (email) => (email || '_').toLowerCase()

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } }
function save(all) { try { localStorage.setItem(KEY, JSON.stringify(all)) } catch {} }

// file: everything on this file, and everything inside it when it is a folder.
// person: every share with this person, group, domain or "anyone".
// pair: this person's access that comes from this folder or file.
export const ignoreKey = {
  file: (fileId) => 'file:' + fileId,
  person: (personKey) => 'person:' + personKey,
  pair: (sourceId, personKey) => `pair:${sourceId}|${personKey}`,
}
export const KIND_LABEL = { file: 'File or folder', person: 'Person', pair: 'Person on a folder' }

export function listIgnores(email) { return load()[acct(email)] || [] }

export function addIgnores(email, entries) {
  const all = load()
  const cur = all[acct(email)] || []
  const have = new Set(cur.map((e) => e.key))
  const next = [...cur, ...entries.filter((e) => e?.key && !have.has(e.key)).map((e) => ({ ...e, at: Date.now() }))]
  all[acct(email)] = next
  save(all)
  return next
}

export function removeIgnores(email, keys) {
  const all = load()
  const drop = new Set(keys)
  const next = (all[acct(email)] || []).filter((e) => !drop.has(e.key))
  all[acct(email)] = next
  save(all)
  return next
}

export function clearIgnores(email) {
  const all = load()
  delete all[acct(email)]
  save(all)
  return []
}

export function clearAllIgnores() { try { localStorage.removeItem(KEY) } catch {} }

// Remembers who was connected, in this browser only, so a reload doesn't need a
// fresh sign-in. No token is stored here: only email/name/picture and the
// inactivity window. The token itself lives in memory in google.js.

const KEY = 'wha_connection'
export const TTL_OPTIONS = [1, 3, 7]
export const DEFAULT_TTL_DAYS = 3

export function getConnection() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setConnection(conn) {
  localStorage.setItem(KEY, JSON.stringify(conn))
}

export function clearConnection() {
  localStorage.removeItem(KEY)
}

export function touch() {
  const c = getConnection()
  if (c) setConnection({ ...c, lastActiveAt: Date.now() })
}

export function ttlDays() {
  return getConnection()?.ttlDays || DEFAULT_TTL_DAYS
}

export function setTtlDays(days) {
  const c = getConnection()
  if (c) setConnection({ ...c, ttlDays: days })
}

export function msUntilExpiry(c = getConnection()) {
  if (!c) return 0
  return c.lastActiveAt + (c.ttlDays || DEFAULT_TTL_DAYS) * 864e5 - Date.now()
}

export function isExpired(c = getConnection()) {
  return msUntilExpiry(c) <= 0
}

// Theme preference: 'light' | 'dark' | null (follow the system).
const THEME_KEY = 'wha_theme'
export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) } catch { return null }
}
export function setTheme(t) {
  try { t ? localStorage.setItem(THEME_KEY, t) : localStorage.removeItem(THEME_KEY) } catch {}
}

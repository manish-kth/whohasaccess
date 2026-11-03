import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './lib/api.js'
import { analyze } from './lib/analyze.js'
import { applyChanges } from './lib/actions.js'
import { TTL_OPTIONS, getTheme, setTheme } from './lib/session.js'
import { snapshotsEnabled, setSnapshotsEnabled, listSnapshots, saveSnapshot, diffSnapshot, clearSnapshots } from './lib/snapshots.js'
import { listIgnores, addIgnores, removeIgnores, clearIgnores, clearAllIgnores } from './lib/ignores.js'
import { keepScanEnabled, setKeepScan, saveScan, loadScan, clearScans } from './lib/scancache.js'
import { Avatar, Spinner, Tag, fmt } from './components/ui.jsx'
import { ISSUE_META } from './components/Overview.jsx'
import Dashboard from './components/Dashboard.jsx'

/* ---------------- Theme: light / dark / follow the system ---------------- */
function useTheme() {
  const [pref, setPref] = useState(() => getTheme())
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', pref ? pref === 'dark' : mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])
  const cycle = () => { const next = pref === null ? 'dark' : pref === 'dark' ? 'light' : null; setTheme(next); setPref(next) }
  return [pref, cycle]
}

/* ---------------- Privacy / connection menu ---------------- */
function PrivacyMenu({ conn, demo, onForget, onTtl, snaps, onSnaps, keep, onKeep }) {
  const [open, setOpen] = useState(false)
  const ttl = conn?.ttlDays || 3
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-ghost">🛡️ Privacy ▾</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 card shadow-pop z-50 p-4 text-left animate-rise">
            {!demo && (
              <>
                <div className="text-xs font-bold uppercase tracking-wide text-ink3 mb-2">Auto-forget after</div>
                <div className="flex gap-1 bg-surface2 rounded-lg p-1 mb-2">
                  {TTL_OPTIONS.map((d) => (
                    <button key={d} onClick={() => onTtl(d)} className={`flex-1 py-1.5 rounded-md text-sm font-semibold ${ttl === d ? 'bg-surface shadow-card text-ink' : 'text-ink2'}`}>{d} day{d > 1 ? 's' : ''}</button>
                  ))}
                </div>
                <p className="text-xs text-ink3 mb-3">Your Google authorization lives in this tab's memory only. After {ttl} day{ttl > 1 ? 's' : ''} without use, the app forgets you were ever connected.</p>
              </>
            )}
            {!demo && (
              <>
                <label className="flex items-start gap-2 cursor-pointer mb-1">
                  <input type="checkbox" checked={keep} onChange={(e) => onKeep(e.target.checked)} className="mt-0.5 accent-[rgb(var(--brand))]" />
                  <span className="text-sm text-ink">Keep the last scan in this browser</span>
                </label>
                <p className="text-xs text-ink3 mb-3 pl-6">A refresh opens the report straight away; Re-scan when you want fresh data. File names and sharing settings sit in this browser's storage until Forget.</p>
              </>
            )}
            <label className="flex items-start gap-2 cursor-pointer mb-1">
              <input type="checkbox" checked={snaps} onChange={(e) => onSnaps(e.target.checked)} className="mt-0.5 accent-[rgb(var(--brand))]" />
              <span className="text-sm text-ink">Remember shares between scans</span>
            </label>
            <p className="text-xs text-ink3 mb-3 pl-6">Keeps a compact list (file ids, names, who has what) in this browser's own storage, so the next scan can say what changed. Never leaves the browser; wiped by Forget.</p>
            <div className="text-xs text-ink3 mb-3">
              <div className="font-bold uppercase tracking-wide mb-1">What this browser keeps</div>
              <ul className="space-y-0.5">
                <li>· Who connected (email, name) and when</li>
                <li>· Theme and your Google client ID</li>
                <li>· Your ignore list, if you use it (names of files and people)</li>
                <li>· {keep ? 'The last scan (file names and sharing settings)' : 'No scan data after a refresh'}</li>
                <li>· {snaps ? 'Share snapshots (on)' : 'No file data at all'}</li>
                <li>· <b>Never</b> the access token</li>
              </ul>
            </div>
            <button onClick={onForget} className="btn-danger w-full">{demo ? 'Exit demo' : 'Forget & disconnect now'}</button>
            <p className="text-xs text-ink3 mt-3 text-center"><a href="/privacy.html" className="hover:text-ink hover:underline">Privacy policy</a> · <a href="/terms.html" className="hover:text-ink hover:underline">Terms</a></p>
          </div>
        </>
      )}
    </div>
  )
}

function Header({ conn, demo, onForget, onTtl, snaps, onSnaps, keep, onKeep, theme, onTheme }) {
  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'
  return (
    <header className="bg-surface/80 backdrop-blur sticky top-0 z-30 border-b border-line">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
        <div className="font-extrabold text-ink flex items-center gap-2"><span className="text-xl">🔐</span> WhoHasAccess</div>
        {demo && <Tag color="amber">DEMO</Tag>}
        <span className="hidden md:inline"><Tag color="green">runs only in your browser</Tag></span>
        <div className="flex-1" />
        <button onClick={onTheme} className="btn-ghost" title={`Theme: ${theme || 'system'} (click to change)`}>{themeIcon}</button>
        {conn && (
          <div className="flex items-center gap-2">
            <Avatar name={conn.name} photo={conn.picture} size={28} />
            <span className="text-sm text-ink2 hidden sm:block">{conn.email}</span>
            <PrivacyMenu conn={conn} demo={demo} onForget={onForget} onTtl={onTtl} snaps={snaps} onSnaps={onSnaps} keep={keep} onKeep={onKeep} />
          </div>
        )}
      </div>
    </header>
  )
}

/* ---------------- Client-ID setup (self-host) ---------------- */
function ClientIdSetup({ onSave, onCancel }) {
  const [val, setVal] = useState('')
  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 pt-16 pb-24">
      <div className="card p-6">
        <h2 className="text-xl font-bold text-ink">Connect your own Google client</h2>
        <p className="text-sm text-ink2 mt-2">
          This app has no backend, so it uses <b>your</b> Google OAuth <b>Client ID</b> (public, no secret). Create one in the Google Cloud Console
          (Web application), add this site's URL as an <b>Authorized JavaScript origin</b>, then paste the Client ID below. Full steps are in the README.
        </p>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="xxxxx.apps.googleusercontent.com" className="input mt-4 font-mono" />
        <div className="flex gap-2 mt-4">
          <button onClick={() => val.trim() && onSave(val.trim())} disabled={!val.trim()} className="btn-primary">Save & connect</button>
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
        </div>
        <p className="text-xs text-ink3 mt-3">Stored only in this browser. Sent only to Google.</p>
      </div>
    </div>
  )
}

/* ---------------- Landing ---------------- */
const SCOPE_CHOICES = [
  ['owned', '📁 Files I own', 'What you can actually clean up. Fast.'],
  ['shared', '🤝 Shared with me', "Other people's files. Can be huge."],
  ['both', '🌐 Both', 'Everything you can see. Slowest.'],
]
export const scopesFor = (choice) => (choice === 'both' ? ['owned', 'shared'] : [choice])

function Landing({ onConnect, onDemo, starting, conn, scopeChoice, setScopeChoice }) {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-24">
      <div className="card hero p-8 sm:p-12 text-center">
        <div className="text-5xl mb-3">🔐</div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-ink leading-tight">Who can open<br className="sm:hidden" /> your Google Drive?</h1>
        <p className="text-lg text-ink2 mt-4 max-w-xl mx-auto">
          A security score, every leak ranked worst-first, and one-click fixes with Undo. Nothing leaves your browser.
        </p>
        <div className="grid sm:grid-cols-3 gap-2 mt-8 text-left max-w-2xl mx-auto">
          {SCOPE_CHOICES.map(([k, label, hint]) => (
            <button key={k} onClick={() => setScopeChoice(k)}
              className={`p-3 rounded-xl ring-1 text-left transition ${scopeChoice === k ? 'ring-2 ring-brand bg-brand-soft' : 'ring-line bg-surface hover:ring-brand/50'}`}>
              <div className="font-semibold text-ink text-sm">{label}</div>
              <div className="text-xs text-ink3 mt-0.5">{hint}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <button onClick={onConnect} disabled={starting} className="btn-primary text-base px-6 py-3 rounded-xl shadow-pop">
            {starting ? <Spinner /> : '🔍'} {conn ? `Scan as ${conn.email}` : 'Scan my Google Drive'}
          </button>
          <button onClick={onDemo} disabled={starting} className="btn-outline text-base px-6 py-3 rounded-xl">Try the live demo</button>
        </div>
        <p className="text-xs text-ink3 mt-4">Google will ask for read access to Drive metadata and permission to change sharing. File contents are never read.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mt-6">
        {[
          ['🚫🖥️', 'No server, no account', 'Static files. Your token and file list stay in this tab. Close it and they are gone.'],
          ['🩹', 'Built to fix, not just report', 'Remove, downgrade to viewer, set a 30-day expiry, or make a public link unsearchable. In bulk, by folder, with Undo.'],
          ['🧭', 'Finds what you forgot', 'Public links, external editors, stale shares, personal email accounts, sensitive-looking names, domain-wide links.'],
        ].map(([ic, t, d]) => (
          <div key={t} className="card p-5">
            <div className="text-2xl">{ic}</div>
            <div className="font-bold text-ink mt-2">{t}</div>
            <div className="text-sm text-ink2 mt-1">{d}</div>
          </div>
        ))}
      </div>

      <div className="card p-5 mt-6">
        <div className="font-bold text-ink">What it checks</div>
        <div className="grid sm:grid-cols-3 gap-x-6 gap-y-2 mt-3">
          {Object.entries(ISSUE_META).map(([k, m]) => (
            <div key={k} className="flex items-start gap-2 text-sm"><span>{m.icon}</span><div><div className="font-medium text-ink">{m.title}</div><div className="text-xs text-ink3">{m.sub}</div></div></div>
          ))}
        </div>
      </div>

      <p className="mt-8 text-sm text-ink3 text-center max-w-2xl mx-auto">
        🛡️ Open source and privacy first. Only file <i>metadata</i> and sharing settings are read, straight from Google to your browser. There is no server to keep anything.
      </p>
      <p className="mt-3 text-xs text-ink3 text-center">
        <a href="/privacy.html" className="hover:text-ink hover:underline">Privacy</a> · <a href="/terms.html" className="hover:text-ink hover:underline">Terms</a> · <a href="https://github.com/manish-kth/whohasaccess" target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">Source on GitHub</a>
      </p>
      <p className="mt-1.5 text-xs text-ink3 text-center">
        🕯️ In memoriam: the original <a href="https://www.whohasaccess.com/" target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">whohasaccess.com</a> shut its doors, but the idea was too good to lose.
        <br />This is a tribute, open source and server-free. Thank you to its makers 🙏 Not affiliated.
      </p>
    </div>
  )
}

function Scanning({ counts, scopes, onStop, stopping }) {
  const total = (counts.owned || 0) + (counts.shared || 0)
  return (
    <div className="max-w-md mx-auto px-6 pt-24 text-center">
      <div className="inline-grid place-items-center w-20 h-20 rounded-full bg-brand-soft text-brand mb-6"><Spinner className="w-8 h-8" /></div>
      <h2 className="text-2xl font-bold text-ink">Scanning your Drive</h2>
      <p className="text-sm text-ink3 mt-1 num">{total > 0 ? `${fmt(total)} items so far…` : 'Opening Google sign-in and listing files…'}</p>
      <div className="mt-6 space-y-2 text-left">
        {scopes.map((k) => (
          <div key={k} className="card flex items-center justify-between px-4 py-2">
            <span className="text-ink font-medium">{k === 'owned' ? 'Files I own' : 'Shared with me'}</span>
            <span className="text-ink2 num">{fmt(counts[k] || 0)}</span>
          </div>
        ))}
      </div>
      <button onClick={onStop} disabled={stopping || total === 0} className="btn-outline mt-6">
        {stopping ? 'Stopping after this page…' : 'Stop and show what we have'}
      </button>
      <p className="text-xs text-ink3 mt-6">Large Drives take a while: about 1,000 items per request. Nothing is uploaded anywhere.</p>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('loading') // loading | landing | setup | scanning | dashboard
  const [conn, setConn] = useState(null)
  const [demo, setDemo] = useState(false)
  const [scan, setScan] = useState(null)
  const [scope, setScope] = useState('owned')
  const [scopeChoice, setScopeChoice] = useState('owned')
  const [scanScopes, setScanScopes] = useState(['owned'])
  const [counts, setCounts] = useState({})
  const [stopping, setStopping] = useState(false)
  const stopRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [snaps, setSnaps] = useState(() => snapshotsEnabled())
  const [drift, setDrift] = useState({})
  const [ignores, setIgnores] = useState([])
  const [keep, setKeep] = useState(() => keepScanEnabled())
  const savedRef = useRef(null) // the scan object last saved to / loaded from this browser
  const [theme, cycleTheme] = useTheme()
  const didInit = useRef(false)

  const analysis = useMemo(() => (scan ? analyze(scan, scope, ignores) : null), [scan, scope, ignores])

  // The ignore list is per account, in this browser only.
  useEffect(() => { setIgnores(conn ? listIgnores(conn.email) : []) }, [conn?.email]) // eslint-disable-line react-hooks/exhaustive-deps
  const ignore = (entries) => setIgnores(addIgnores(conn?.email, Array.isArray(entries) ? entries : [entries]))
  const unignore = (keys) => setIgnores(removeIgnores(conn?.email, Array.isArray(keys) ? keys : [keys]))
  const clearIg = () => setIgnores(clearIgnores(conn?.email))

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const resumed = api.resume()
    if (!resumed) { setView('landing'); return }
    setConn(resumed)
    loadScan(resumed.email).then((cached) => {
      if (cached && cached.files.length) {
        savedRef.current = cached
        setScan(cached); setScanScopes(cached.scopes); setScope(cached.scopes[0]); setView('dashboard')
      } else setView('landing')
    })
  }, [])

  // Keep the current scan (after a scan, and after fixes) in this browser.
  useEffect(() => {
    if (!scan || scan.demo || scan === savedRef.current || !keep) return
    const t = setTimeout(() => { savedRef.current = scan; saveScan(scan).catch(() => {}) }, 1200)
    return () => clearTimeout(t)
  }, [scan, keep])

  // Enforce the inactivity window while the tab stays open.
  useEffect(() => {
    const t = setInterval(() => { if (!demo && api.getConnection() && api.isExpired()) forget() }, 60 * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo])

  // Compare against the previous local snapshot (if the user opted in), then keep this one.
  async function trackSnapshots(next, scopes) {
    if (next.demo) {
      setDrift({ owned: { since: Date.now() - 6 * 864e5, prevScore: 61, newShares: [1, 2, 3], removedShares: [1], newPeople: ['x'], newlyPublic: 1 } })
      return
    }
    if (!snapshotsEnabled()) return
    const email = next.me?.emailAddress
    for (const s of scopes) {
      try {
        const an = analyze(next, s)
        const prev = (await listSnapshots(email, s))[0]
        setDrift((d) => ({ ...d, [s]: diffSnapshot(an, prev) }))
        await saveSnapshot(an)
      } catch { /* snapshots are best-effort */ }
    }
  }

  // merge: replace only the scanned pools in the current scan (re-scan one pool, or add the other).
  async function runScan(scopes = scanScopes, { merge = false } = {}) {
    const prev = scan
    setView('scanning'); setError(null); setCounts({}); setScanScopes(scopes)
    stopRef.current = false; setStopping(false)
    try {
      const data = await api.scan({ scopes, onProgress: setCounts, shouldStop: () => stopRef.current })
      const next = merge && prev
        ? { ...data, scopes: [...new Set([...prev.scopes, ...scopes])], files: [...prev.files.filter((f) => !scopes.includes(f.ownedByMe ? 'owned' : 'shared')), ...data.files] }
        : data
      setScan(next)
      setScope(merge || !scopes.includes(scope) ? scopes[0] : scope)
      setView('dashboard')
      trackSnapshots(next, scopes)
    } catch (e) {
      setError(e.message); setView(prev && merge ? 'dashboard' : 'landing')
    }
  }
  const stopScan = () => { stopRef.current = true; setStopping(true) }

  async function connect() {
    if (!api.clientIdConfigured()) { setView('setup'); return }
    setStarting(true); setError(null)
    try {
      const c = await api.connect()
      setConn(c); setDemo(false)
      await runScan(scopesFor(scopeChoice))
    } catch (e) { setError(e.message) } finally { setStarting(false) }
  }
  function saveClientId(id) { api.setClientId(id); setView('landing'); setTimeout(connect, 50) }
  function startDemo() {
    const u = api.startDemo()
    setConn({ email: u.email, name: u.name, demo: true }); setDemo(true)
    runScan(scopesFor(scopeChoice))
  }
  async function forget() {
    await api.forget().catch(() => {})
    await clearSnapshots().catch(() => {})
    clearAllIgnores()
    await clearScans()
    savedRef.current = null
    setScan(null); setConn(null); setDemo(false); setError(null); setDrift({}); setIgnores([])
    setView('landing')
  }
  function setTtl(days) { api.setTtlDays(days); setConn(api.getConnection()) }
  function toggleSnaps(on) { setSnapshotsEnabled(on); setSnaps(on); if (!on) setDrift({}) }
  function toggleKeep(on) { setKeepScan(on); setKeep(on); if (on && scan && !scan.demo) { savedRef.current = scan; saveScan(scan).catch(() => {}) } else if (!on) savedRef.current = null }
  const handleChanges = (changes) => setScan((prev) => (prev ? applyChanges(prev, changes) : prev))

  return (
    <div className="min-h-screen">
      <Header conn={conn} demo={demo} onForget={forget} onTtl={setTtl} snaps={snaps} onSnaps={toggleSnaps} keep={keep} onKeep={toggleKeep} theme={theme} onTheme={cycleTheme} />
      {error && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-danger-soft text-danger ring-1 ring-danger/30 rounded-lg px-4 py-2 text-sm flex items-center gap-3">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-lg leading-none">×</button>
          </div>
        </div>
      )}
      {view === 'loading' && <div className="pt-32 grid place-items-center text-ink3"><Spinner className="w-6 h-6" /></div>}
      {view === 'landing' && <Landing onConnect={connect} onDemo={startDemo} starting={starting} conn={conn} scopeChoice={scopeChoice} setScopeChoice={setScopeChoice} />}
      {view === 'setup' && <ClientIdSetup onSave={saveClientId} onCancel={() => setView('landing')} />}
      {view === 'scanning' && <Scanning counts={counts} scopes={scanScopes} onStop={stopScan} stopping={stopping} />}
      {view === 'dashboard' && analysis && (
        <Dashboard analysis={analysis} onChanges={handleChanges} onRescan={runScan} onScope={setScope} drift={drift[scope]}
          ignores={ignores} onIgnore={ignore} onUnignore={unignore} onClearIgnores={clearIg} />
      )}
    </div>
  )
}

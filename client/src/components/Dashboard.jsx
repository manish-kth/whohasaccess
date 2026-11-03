import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ACTIONS, runBulk } from '../lib/actions.js'
import Overview from './Overview.jsx'
import FixLeaks, { ISSUE_ORDER } from './FixLeaks.jsx'
import PeopleView from './PeopleView.jsx'
import FilesView from './FilesView.jsx'
import MapView from './MapView.jsx'
import { PersonDrawer, FileDrawer } from './Drawers.jsx'
import IgnoreList from './IgnoreList.jsx'
import TransferModal from './TransferModal.jsx'
import { Tag, Toasts, Spinner, fmt, ago } from './ui.jsx'

const POOLS = [['owned', 'Files I own'], ['shared', 'Shared with me']]

function ScopeBar({ a, onScope, onRescan, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 bg-surface2 rounded-xl p-1">
        {POOLS.map(([k, label]) => {
          const scanned = a.scopes.includes(k)
          const on = a.scope === k
          return (
            <div key={k} className={`flex items-center rounded-lg ${on ? 'bg-surface shadow-card ring-1 ring-line' : ''}`}>
              <button onClick={() => (scanned ? onScope(k) : onRescan([k], { merge: true }))} disabled={disabled}
                className={`px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${on ? 'text-ink' : 'text-ink2 hover:text-ink'}`}>
                {label} {scanned ? <span className="num opacity-70">{fmt(a.counts[k])}</span> : <span className="text-xs text-brand">· scan</span>}
              </button>
              {scanned && (
                <button onClick={() => onRescan([k], { merge: true })} disabled={disabled} className="px-2 py-1.5 text-ink3 hover:text-brand" title={`Re-scan ${label.toLowerCase()}`}>↻</button>
              )}
            </div>
          )
        })}
      </div>
      <span className="text-xs text-ink3">scanned {ago(a.scannedAt)}</span>
      {a.cached && <Tag color="blue" title="Opened from the copy kept in this browser. Re-scan for fresh data.">saved copy</Tag>}
      {a.stopped && <Tag color="amber">stopped early · partial</Tag>}
      {a.demo && <Tag color="amber">demo data</Tag>}
    </div>
  )
}

let toastSeq = 0

export default function Dashboard({ analysis: a, onChanges, onRescan, onScope, drift, ignores = [], onIgnore, onUnignore, onClearIgnores }) {
  const [tab, setTab] = useState('overview')
  const [issueKey, setIssueKey] = useState(null)
  const [personKey, setPersonKey] = useState(null)
  const [fileId, setFileId] = useState(null)
  const [peopleInitial, setPeopleInitial] = useState(null)
  const [filesInitial, setFilesInitial] = useState(null)
  const [folderId, setFolderId] = useState(null)
  const [busy, setBusy] = useState(null)
  const [toasts, setToasts] = useState([])
  const [showIgnores, setShowIgnores] = useState(false)
  const [transferFiles, setTransferFiles] = useState(null)
  const igSet = useMemo(() => new Set(ignores.map((e) => e.key)), [ignores])
  const stopRef = useRef(false)
  const busyRef = useRef(false)

  const fileById = useMemo(() => new Map(a.files.map((f) => [f.id, f])), [a.files])
  const person = personKey ? a.people.find((p) => p.key === personKey) : null
  const file = fileId ? fileById.get(fileId) : null
  useEffect(() => { if (personKey && !person) setPersonKey(null) }, [personKey, person])
  useEffect(() => { if (fileId && !file) setFileId(null) }, [fileId, file])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tab])

  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const push = useCallback((t) => {
    const id = ++toastSeq
    setToasts((ts) => [...ts.slice(-3), { ...t, id }])
    if (t.ttl !== 0) setTimeout(() => dismiss(id), t.ttl || 12000)
    return id
  }, [dismiss])
  const patchToast = (id, patch) => setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  // Runs a fix on a set of targets (items or folder groups), applies the result
  // locally and offers Undo. Returns the runBulk result.
  const act = useCallback(async (action, targets, { label } = {}) => {
    if (!targets?.length || busyRef.current) return null
    busyRef.current = true
    stopRef.current = false
    setBusy({ label: `${ACTIONS[action].label}${label ? ` · ${label}` : ''}`, done: 0, total: targets.length })
    const res = await runBulk(action, targets, {
      onProgress: ({ done, total }) => setBusy((b) => (b ? { ...b, done, total } : b)),
      shouldStop: () => stopRef.current,
    })
    busyRef.current = false
    setBusy(null)
    if (res.changes.length) onChanges(res.changes)
    const affected = res.changes.reduce((n, c) => n + c.affected.length, 0)
    if (res.failed) push({ tone: 'danger', text: `Stopped after ${fmt(res.done)} of ${fmt(res.total)}.`, sub: res.failed.message, ttl: 20000 })
    else if (res.done < res.total) push({ tone: 'warn', text: `Stopped: ${fmt(res.done)} of ${fmt(res.total)} done.`, ttl: 8000 })
    if (res.done > 0 && !res.undos.length) {
      // Some things can't be undone from here (taking ownership): say so.
      push({ tone: 'ok', text: `${ACTIONS[action].verb} · ${fmt(res.done)} ${res.done === 1 ? 'file' : 'files'}`, sub: a.demo ? 'Demo: nothing really changed.' : action === 'accept-owner' ? 'They stay on as an editor.' : undefined, ttl: 15000 })
    }
    if (res.undos.length) {
      const undos = res.undos
      const id = push({
        tone: 'ok',
        text: `${ACTIONS[action].verb} · ${fmt(res.done)} ${res.done === 1 ? 'share' : 'shares'}${affected > res.done ? ` covering ${fmt(affected)} items` : ''}`,
        sub: a.demo ? 'Demo: nothing really changed.' : 'Undo puts it back without emailing anyone.',
        ttl: 45000,
        action: { label: 'Undo', run: async () => {
          patchToast(id, { action: { label: 'Undoing', busy: true } })
          const changes = []
          let failed = null
          for (const u of undos.slice().reverse()) {
            try { changes.push(await u.run()) } catch (e) { failed = e; break }
          }
          if (changes.length) onChanges(changes)
          dismiss(id)
          push(failed ? { tone: 'danger', text: `Undo stopped: ${failed.message}`, ttl: 15000 } : { tone: 'ok', text: `Restored ${fmt(changes.length)} ${changes.length === 1 ? 'share' : 'shares'}.` })
        } },
      })
    }
    return res
  }, [onChanges, push, dismiss, a.demo])

  // Mark things as intentionally shared, with Undo.
  const ignore = useCallback((entries) => {
    const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e?.key && !igSet.has(e.key))
    if (!list.length) return
    onIgnore(list)
    const id = push({
      tone: 'ok',
      text: `Ignored ${list.length === 1 ? list[0].label : fmt(list.length) + ' things'}.`,
      sub: 'Left out of leaks and the score. Manage under “Ignored”.',
      ttl: 20000,
      action: { label: 'Undo', run: () => { onUnignore(list.map((e) => e.key)); dismiss(id) } },
    })
  }, [igSet, onIgnore, onUnignore, push, dismiss])

  const openPerson = useCallback((keyOrPerson) => setPersonKey(typeof keyOrPerson === 'string' ? keyOrPerson : keyOrPerson?.key), [])
  const openFile = useCallback((id) => {
    if (fileById.has(id)) return setFileId(id)
    const other = a.byId.get(id)
    push(other
      ? { tone: 'warn', text: `"${other.name}" is in the ${other.ownedByMe ? 'Files I own' : 'Shared with me'} pool.`, sub: 'Switch pools at the top to open it.' }
      : { tone: 'warn', text: 'That folder was not part of this scan.' })
  }, [fileById, a.byId, push])
  // Open the folder a file sits in: its drawer when it is in this pool,
  // otherwise the folder in Google Drive (other pool, My Drive root, not scanned).
  const openFolder = useCallback((f) => {
    const pid = f?.parents?.[0]
    if (!pid) return push({ tone: 'warn', text: 'No folder known for this item.' })
    if (fileById.has(pid)) return setFileId(pid)
    window.open('https://drive.google.com/drive/folders/' + encodeURIComponent(pid), '_blank', 'noopener,noreferrer')
  }, [fileById, push])
  const onTransfer = useCallback((files) => { if (files?.length) { setFileId(null); setTransferFiles(files) } }, [])
  const onTransferDone = useCallback((res, { email, direct }) => {
    if (!res.done && !res.failures.length) return
    const what = direct ? `Transferred ${fmt(res.done)} ${res.done === 1 ? 'file' : 'files'} to ${email}` : `Sent ${fmt(res.done)} ownership ${res.done === 1 ? 'invite' : 'invites'} to ${email}`
    push(res.failures.length
      ? { tone: 'warn', text: `${what}. ${fmt(res.failures.length)} refused.`, sub: a.demo ? 'Demo: nothing really changed.' : 'The list in the dialog says which ones and why.', ttl: 20000 }
      : { tone: 'ok', text: what + '.', sub: a.demo ? 'Demo: nothing really changed.' : direct ? 'You stay on as an editor.' : 'They need to accept each one.', ttl: 15000 })
  }, [push, a.demo])
  const goIssue = (k) => { setTab('fix'); if (k) setIssueKey(k) }
  const goPeople = (init) => { setTab('people'); setPeopleInitial(init ? { ...init, _t: Date.now() } : null) }
  const goFiles = (init) => { setTab('files'); setFolderId(null); setFilesInitial(init ? { ...init, _t: Date.now() } : null) }
  const goInside = (id) => { setFileId(null); setPersonKey(null); setTab('files'); setFolderId(id); setFilesInitial({ level: 'shared', _t: Date.now() }) }
  const goMap = () => setTab('map')

  const issueTotal = ISSUE_ORDER.slice(0, 6).reduce((n, k) => n + a.issues[k].items.length, 0)
  const TABS = [['overview', 'Overview'], ['fix', '🩹 Fix leaks', issueTotal], ['people', 'People', a.totals.people], ['files', 'Files', a.totals.shared], ['map', '🗺️ Map']]

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
      <div className="pt-4">
        <ScopeBar a={a} onScope={(k) => { setPersonKey(null); setFileId(null); setFolderId(null); onScope(k) }} onRescan={onRescan} disabled={!!busy} />
      </div>
      <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-bg/85 backdrop-blur">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${tab === k ? 'bg-surface ring-1 ring-line text-ink shadow-card' : 'text-ink2 hover:text-ink hover:bg-surface2'}`}>
              {label}{n != null && <span className={`num ml-1.5 text-xs ${k === 'fix' && n > 0 ? 'text-danger' : 'text-ink3'}`}>{fmt(n)}</span>}
            </button>
          ))}
          <div className="flex-1" />
          {ignores.length > 0 && <button onClick={() => setShowIgnores(true)} className="btn-ghost" title="Things you marked as intentionally shared">🙈 {fmt(ignores.length)} ignored</button>}
          <button onClick={() => onRescan(a.scopes, { merge: false })} disabled={!!busy} className="btn-ghost">↻ Re-scan all</button>
        </div>
      </div>

      {tab === 'overview' && <Overview a={a} drift={drift} goIssue={goIssue} goPeople={goPeople} goFiles={goFiles} openPerson={openPerson} goMap={goMap} openIgnores={() => setShowIgnores(true)} />}
      {tab === 'fix' && <FixLeaks a={a} issueKey={issueKey} setIssueKey={setIssueKey} act={act} busy={busy} openPerson={openPerson} openFile={openFile} openFolder={openFolder} ignore={ignore} openIgnores={() => setShowIgnores(true)} />}
      {tab === 'people' && <PeopleView a={a} onOpen={openPerson} initial={peopleInitial} />}
      {tab === 'files' && <FilesView onTransfer={onTransfer} a={a} onOpen={openFile} onFolder={openFolder} initial={filesInitial} folderId={folderId} onClearFolder={() => setFolderId(null)} />}
      {tab === 'map' && <MapView a={a} openFile={openFile} goInside={goInside} />}

      {person && <PersonDrawer person={person} a={a} onClose={() => setPersonKey(null)} act={act} busy={busy} openFile={openFile} openFolder={openFolder} igSet={igSet} ignore={ignore} unignore={onUnignore} />}
      {file && <FileDrawer onTransfer={onTransfer} file={file} a={a} onClose={() => setFileId(null)} act={act} busy={busy} openPerson={openPerson} openFile={openFile} openFolder={openFolder} goInside={goInside} igSet={igSet} ignore={ignore} unignore={onUnignore} />}
      {showIgnores && <IgnoreList a={a} ignores={ignores} onUnignore={onUnignore} onClear={onClearIgnores} onClose={() => setShowIgnores(false)} />}
      {transferFiles && <TransferModal a={a} files={transferFiles} onClose={() => setTransferFiles(null)} onChanges={onChanges} onDone={onTransferDone} />}

      {busy && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] card px-4 py-2.5 flex items-center gap-3 text-sm shadow-pop">
          <Spinner /> <span className="text-ink">{busy.label}</span>
          <span className="num text-ink3">{fmt(busy.done)}/{fmt(busy.total)}</span>
          <div className="w-32 h-1.5 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${busy.total ? (100 * busy.done) / busy.total : 0}%` }} /></div>
          <button onClick={() => { stopRef.current = true }} className="btn-ghost">Stop</button>
        </div>
      )}
      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  )
}

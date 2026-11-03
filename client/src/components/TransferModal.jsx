import React, { useEffect, useMemo, useRef, useState } from 'react'
import { runTransfer } from '../lib/actions.js'
import { FOLDER, FREE_MAIL, domainOf, fileType, fileIcon } from '../lib/analyze.js'
import { Modal, Spinner, Checkbox, fmt } from './ui.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Folders don't carry their contents with them when ownership moves, so a
// selected folder means the folder plus every owned item inside it.
export function expandSelection(a, picked) {
  const seen = new Set()
  const all = []
  let folders = 0
  const visit = (f, depth) => {
    if (!f || seen.has(f.id) || !f.ownedByMe) return
    seen.add(f.id)
    all.push(f)
    if (f.mimeType === FOLDER) {
      folders++
      if (depth < 64) for (const c of a.children?.get(f.id) || []) visit(c, depth + 1)
    }
  }
  const direct = [...new Map(picked.filter(Boolean).map((f) => [f.id, f])).values()]
  for (const f of direct) visit(f, 0)
  return { all, folders, direct: direct.length, inside: all.length - direct.length }
}

export default function TransferModal({ a, files, onClose, onChanges, onDone }) {
  const [email, setEmail] = useState('')
  const [ack, setAck] = useState(false)
  const [phase, setPhase] = useState('setup') // setup | running | done
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 })
  const [result, setResult] = useState(null)
  const stopRef = useRef(false)
  const flushedRef = useRef(0)

  // Expanded once, when the dialog opens: the analysis changes underneath as
  // files leave the pool, and the summary must keep describing what was picked.
  const [sel] = useState(() => expandSelection(a, files || []))
  const types = useMemo(() => {
    const m = new Map()
    for (const f of sel.all) if (f.mimeType !== FOLDER) { const t = fileType(f.mimeType); m.set(t, (m.get(t) || 0) + 1) }
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [sel])

  const to = email.trim().toLowerCase()
  const myEmail = (a.me?.emailAddress || '').toLowerCase()
  const toDomain = domainOf(to)
  const valid = EMAIL_RE.test(to) && to !== myEmail
  const direct = valid && Boolean(a.myDomain) && !FREE_MAIL.has(a.myDomain) && toDomain === a.myDomain
  const n = sel.all.length
  const noun = n === 1 ? 'file' : 'files'
  const canGo = valid && n > 0 && (!direct || ack)

  useEffect(() => { setAck(false) }, [direct])

  async function go() {
    if (!canGo) return
    stopRef.current = false
    flushedRef.current = 0
    setPhase('running')
    setProgress({ done: 0, failed: 0, total: n })
    const flush = (changes) => {
      if (changes.length > flushedRef.current) { onChanges(changes.slice(flushedRef.current)); flushedRef.current = changes.length }
    }
    const res = await runTransfer(sel.all, { email: to, direct, me: a.me }, {
      onProgress: (p) => { setProgress(p); flush(p.changes) },
      shouldStop: () => stopRef.current,
    })
    flush(res.changes)
    setResult(res)
    setPhase('done')
    onDone?.(res, { email: to, direct })
  }

  return (
    <Modal open onClose={phase === 'running' ? undefined : onClose} wide>
      <div className="p-5 border-b border-line flex items-start gap-3">
        <span className="text-3xl leading-none">👑</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-extrabold text-ink">Transfer ownership</h2>
          <p className="text-sm text-ink2 mt-1">
            <b className="num text-ink">{fmt(n)}</b> {noun}
            {sel.folders > 0 && <> · <b className="num text-ink">{fmt(sel.folders)}</b> {sel.folders === 1 ? 'folder' : 'folders'}</>}
            {sel.inside > 0 && <> · <b className="num text-ink">{fmt(sel.inside)}</b> reached through the selected folders</>}
            {types.length > 0 && <span className="text-ink3"> · {types.slice(0, 4).map(([t, c]) => `${fmt(c)} ${t}${c > 1 && t !== 'Slides' ? 's' : ''}`).join(', ')}{types.length > 4 ? ', …' : ''}</span>}
          </p>
        </div>
        {phase !== 'running' && <button onClick={onClose} className="text-ink3 hover:text-ink text-2xl leading-none -mt-1" aria-label="Close">×</button>}
      </div>

      {phase === 'setup' && (
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-ink">New owner's Google account</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" type="email" autoFocus className="input w-full mt-1" />
            {to && !EMAIL_RE.test(to) && <span className="text-xs text-danger">That doesn't look like an email address.</span>}
            {to === myEmail && to && <span className="text-xs text-danger">That's you.</span>}
          </label>

          {valid && (
            <div className={`rounded-xl p-3 text-sm ring-1 ${direct ? 'bg-warn-soft ring-warn/30' : 'bg-surface2 ring-line'}`}>
              {direct ? (
                <>
                  <div className="font-semibold text-ink">Transfers immediately</div>
                  <div className="text-ink2 mt-0.5">Same Google Workspace organisation, so Google hands the {noun} over in one step. This cannot be undone from here: only the new owner can give them back.</div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-ink">Sends an ownership invite per file</div>
                  <div className="text-ink2 mt-0.5">
                    {FREE_MAIL.has(a.myDomain) ? 'Personal Google accounts' : 'Accounts outside your organisation'} can only be offered ownership. The recipient gets an email for each file and must accept each one.
                    If they sign in to WhoHasAccess with that account, the <b>Pending ownership</b> section lets them accept all at once. Invites can be cancelled until they are accepted.
                  </div>
                </>
              )}
            </div>
          )}

          <ul className="text-sm text-ink2 space-y-1 list-disc pl-5">
            <li>You stay on every file as an editor.</li>
            <li>Files stay where they are in your folders; nothing moves.</li>
            <li>Storage for non-Google files counts against the new owner.</li>
            <li>Files in shared drives have no owner and are never included.</li>
          </ul>

          <details className="text-sm">
            <summary className="cursor-pointer text-ink2 hover:text-ink">What's included ({fmt(n)})</summary>
            <ul className="mt-2 max-h-56 overflow-y-auto space-y-0.5 pr-2">
              {sel.all.slice(0, 200).map((f) => (
                <li key={f.id} className="flex items-center gap-2 truncate text-ink2"><span>{fileIcon(f.mimeType)}</span><span className="truncate">{f.name}</span></li>
              ))}
              {n > 200 && <li className="text-ink3">+{fmt(n - 200)} more</li>}
            </ul>
          </details>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {direct && <Checkbox checked={ack} onChange={setAck} label="I understand this can't be undone" />}
            <div className="flex-1" />
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={go} disabled={!canGo} className={direct ? 'btn-warn' : 'btn-primary'}>
              {direct ? `Transfer ${fmt(n)} ${noun}` : `Send ${fmt(n)} ${n === 1 ? 'invite' : 'invites'}`}
            </button>
          </div>
          {a.demo && <div className="text-xs text-ink3">Demo: nothing really changes.</div>}
        </div>
      )}

      {phase === 'running' && (
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-3 text-sm text-ink">
            <Spinner /> {direct ? 'Transferring' : 'Sending invites'} to <b>{to}</b>…
            <span className="num text-ink3 ml-auto">{fmt(progress.done + progress.failed)}/{fmt(progress.total)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface2 overflow-hidden">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? (100 * (progress.done + progress.failed)) / progress.total : 0}%` }} />
          </div>
          <div className="flex items-center gap-3 text-xs text-ink3">
            {progress.failed > 0 && <span className="text-danger">{fmt(progress.failed)} refused so far</span>}
            <div className="flex-1" />
            <button onClick={() => { stopRef.current = true }} className="btn-ghost">Stop</button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="p-5 space-y-3">
          <div className="text-sm text-ink">
            {direct
              ? <><b className="num">{fmt(result.done)}</b> of {fmt(result.total)} {result.total === 1 ? 'file' : 'files'} now belong to <b>{to}</b>.</>
              : <><b className="num">{fmt(result.done)}</b> of {fmt(result.total)} {result.total === 1 ? 'invite' : 'invites'} sent to <b>{to}</b>. They need to accept each one.</>}
            {result.stopped && <span className="text-warn"> Stopped early{result.halted?.status === 401 ? ': your Google sign-in expired' : ''}.</span>}
          </div>
          {result.failures.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-danger">{fmt(result.failures.length)} refused by Google</div>
              <ul className="mt-1 max-h-56 overflow-y-auto text-xs space-y-1 pr-2">
                {result.failures.map((x) => (
                  <li key={x.fileId} className="text-ink2"><span className="font-semibold text-ink">{x.name}</span> · {x.message}</li>
                ))}
              </ul>
            </div>
          )}
          {a.demo && <div className="text-xs text-ink3">Demo: nothing really changed.</div>}
          <div className="flex justify-end"><button onClick={onClose} className="btn-primary">Close</button></div>
        </div>
      )}
    </Modal>
  )
}

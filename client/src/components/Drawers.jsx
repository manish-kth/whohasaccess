import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { ACTIONS, applicableActions } from '../lib/actions.js'
import { ignoreKey } from '../lib/ignores.js'
import { EDIT_ROLES, FOLDER, LEVEL_INFO, LEVELS, ROLE_LABEL, ROLE_RANK, STALE_DAYS, fileIcon } from '../lib/analyze.js'
import { Avatar, RoleBadge, Tag, LevelTag, FileCell, Chevron, Modal, Section, Pager, usePaged, Empty, Spinner, folderProps, fmt, ago, ageLabel } from './ui.jsx'

// Inherited access is changed where it comes from: the folder. So the target for
// an inherited item is that person's folder group, which covers every item inside.
function targetFor(it, person) {
  if (it.direct || it.sourceId === it.fileId) return it
  return person?.groups?.find((g) => g.sourceId === it.sourceId) || it
}
const keyOf = (t) => t.key || `${t.fileId}|${t.permissionId}`
const dedupe = (targets) => [...new Map(targets.map((t) => [keyOf(t), t])).values()]

function RowActions({ target, busy, onAct, max = 2 }) {
  const acts = applicableActions(target.perm, { removable: target.removable, mine: target.mine })
  if (!acts.length) return <span className="text-xs text-ink3 px-2" title="Only the owner can change this">—</span>
  const covers = target.items?.length > 1 ? ` (${fmt(target.items.length)})` : ''
  return (
    <div className="flex gap-1 shrink-0">
      {acts.slice(0, max).map((ac) => (
        <button key={ac} onClick={(e) => { e.stopPropagation(); onAct(ac, [target]) }} disabled={!!busy}
          title={`${ACTIONS[ac].help}${covers ? ' Applies on the folder, so it covers everything inside.' : ''}`}
          className={`${ac === 'remove' ? 'text-danger hover:bg-danger-soft' : ac === 'accept-owner' ? 'text-ok hover:bg-ok-soft' : 'text-warn hover:bg-warn-soft'} px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-40`}>
          {ACTIONS[ac].label}{covers}
        </button>
      ))}
    </div>
  )
}

// "Do X on everything shown", with an inline confirm step.
function BulkBar({ targets, actions, busy, onRun, noun = 'rows' }) {
  const [confirm, setConfirm] = useState(null)
  useEffect(() => setConfirm(null), [targets])
  const count = (ac) => targets.filter((g) => applicableActions(g.perm, { removable: g.removable, mine: g.mine }).includes(ac)).length
  if (busy) return <div className="flex items-center gap-2 text-sm text-ink2"><Spinner /> {busy.label}… <span className="num">{fmt(busy.done)}/{fmt(busy.total)}</span></div>
  if (confirm) {
    const n = count(confirm)
    return (
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="text-ink2">{ACTIONS[confirm].label} on <b className="num text-ink">{fmt(n)}</b> {noun} shown?</span>
        <button onClick={() => { setConfirm(null); onRun(confirm, targets) }} className={confirm === 'remove' ? 'btn-danger' : confirm === 'accept-owner' ? 'btn-primary' : 'btn-warn'}>Confirm</button>
        <button onClick={() => setConfirm(null)} className="btn-ghost">Cancel</button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {actions.map((ac) => {
        const n = count(ac)
        return (
          <button key={ac} onClick={() => setConfirm(ac)} disabled={n === 0} className={ac === 'remove' ? 'btn-danger' : 'btn-outline'} title={ACTIONS[ac].help}>
            {ACTIONS[ac].label} <span className="num opacity-70">({fmt(n)})</span>
          </button>
        )
      })}
    </div>
  )
}

function DrawerHead({ children, onClose }) {
  return (
    <div className="flex items-start gap-3 p-5 border-b border-line">
      <div className="flex-1 min-w-0">{children}</div>
      <button onClick={onClose} className="text-ink3 hover:text-ink text-2xl leading-none -mt-1" aria-label="Close">×</button>
    </div>
  )
}

const Stat = ({ n, label, tone }) => (
  <div>
    <div className={`num text-lg font-extrabold ${tone || 'text-ink'}`}>{fmt(n)}</div>
    <div className="text-[11px] text-ink3">{label}</div>
  </div>
)

/* ============================== Person ============================== */

const ROLE_F = [['any', 'Any role'], ['edit', 'Can edit'], ['view', 'View / comment']]
const ONLY_F = [['all', 'Everything'], ['folders', 'Folders'], ['stale', 'Stale'], ['sensitive', 'Sensitive']]

export function PersonDrawer({ person: p, a, onClose, act, busy, openFile, openFolder, igSet, ignore, unignore }) {
  const [grouped, setGrouped] = useState(true)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('any')
  const [only, setOnly] = useState('all')
  const [open, setOpen] = useState(() => new Set())
  const dq = useDeferredValue(q)
  useEffect(() => { setQ(''); setRole('any'); setOnly('all'); setOpen(new Set()) }, [p.key])

  const rows = useMemo(() => {
    const base = grouped
      ? p.groups.map((g) => ({ row: g, target: g, folderRow: g.items.length > 1 || g.items[0]?.sourceId !== g.items[0]?.fileId }))
      : p.files.map((it) => ({ row: { ...it, key: `${it.fileId}|${it.permissionId}`, items: [it] }, target: targetFor(it, p), folderRow: false, inherited: !it.direct && it.sourceId !== it.fileId }))
    const needle = dq.toLowerCase()
    return base.filter(({ row: g }) => {
      if (role === 'edit' && !EDIT_ROLES.has(g.role)) return false
      if (role === 'view' && EDIT_ROLES.has(g.role)) return false
      if (only === 'stale' && !g.items.some((i) => i.ageDays != null && i.ageDays >= STALE_DAYS)) return false
      if (only === 'sensitive' && !g.items.some((i) => i.sensitive)) return false
      if (only === 'folders' && !(g.items.length > 1 || g.mimeType === FOLDER)) return false
      if (needle && !g.name.toLowerCase().includes(needle) && !g.items.some((i) => i.name.toLowerCase().includes(needle))) return false
      return true
    })
  }, [p, grouped, role, only, dq])
  const paged = usePaged(rows, 50)
  const targets = useMemo(() => dedupe(rows.map((r) => r.target)), [rows])
  const run = (action, ts) => act(action, dedupe(ts).filter((g) => applicableActions(g.perm, { removable: g.removable, mine: g.mine }).includes(action)), { label: p.name })
  const filtered = rows.length !== (grouped ? p.groups.length : p.files.length)

  return (
    <Modal open onClose={onClose} wide>
      <DrawerHead onClose={onClose}>
        <div className="flex items-center gap-4">
          <Avatar name={p.name} photo={p.photo} kind={p.kind} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold text-ink truncate">{p.name}</h2>
            <div className="text-sm text-ink3 truncate">{p.email || p.domain || (p.kind === 'anyone' ? 'Anyone with the link' : '')}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <LevelTag level={p.level} />
              {p.personalEmail && <Tag color="amber">Personal email</Tag>}
              {p.kind === 'group' && <Tag color="blue">Google Group</Tag>}
              {p.kind === 'domain' && <Tag color="violet">Whole domain</Tag>}
              <RoleBadge role={p.topRole} />
              {p.lastTouched ? <span className="text-xs text-ink3">· last activity {ago(p.lastTouched)}</span> : null}
              {igSet?.has(ignoreKey.person(p.key))
                ? <button onClick={() => unignore(ignoreKey.person(p.key))} className="btn-outline text-xs">🙈 Ignored · undo</button>
                : <button onClick={() => ignore({ key: ignoreKey.person(p.key), kind: 'person', label: p.name })} className="btn-ghost text-xs" title="Intentionally shared: hide every share with this person from leaks and the score">🙈 Ignore</button>}
            </div>
          </div>
          <div className="hidden sm:grid grid-cols-4 gap-4 text-center">
            <Stat n={p.files.length} label="items" />
            <Stat n={p.editorFiles} label="can edit" tone={p.editorFiles ? 'text-warn' : 'text-ink3'} />
            <Stat n={p.staleFiles} label="stale" tone={p.staleFiles ? 'text-ink' : 'text-ink3'} />
            <Stat n={p.sensitiveFiles} label="sensitive" tone={p.sensitiveFiles ? 'text-pink-600 dark:text-pink-300' : 'text-ink3'} />
          </div>
        </div>
      </DrawerHead>

      {p.removable > 0 && (
        <div className="px-5 py-3 bg-surface2 border-b border-line flex flex-wrap items-center gap-3">
          <BulkBar targets={targets} actions={['remove', 'downgrade', 'expire']} busy={busy} onRun={run} noun={grouped ? 'folders & files' : 'items'} />
          <span className="text-xs text-ink3 ml-auto">{filtered ? 'Acts on the rows shown. ' : ''}{grouped ? 'Folder rows cover everything inside.' : 'Inherited rows act on their folder.'}</span>
        </div>
      )}

      <div className="px-5 py-3 flex flex-col sm:flex-row gap-2 border-b border-line">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this person's files…" className="input flex-1" />
        <div className="flex gap-1 bg-surface2 rounded-lg p-1 shrink-0">
          <button onClick={() => setGrouped(true)} className={grouped ? 'chip-on' : 'chip-off'}>By folder <span className="num opacity-70">({fmt(p.groups.length)})</span></button>
          <button onClick={() => setGrouped(false)} className={!grouped ? 'chip-on' : 'chip-off'}>Every item <span className="num opacity-70">({fmt(p.files.length)})</span></button>
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="select">{ROLE_F.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={only} onChange={(e) => setOnly(e.target.value)} className="select">{ONLY_F.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>

      <div className="divide-y divide-line max-h-[55vh] overflow-y-auto">
        {rows.length === 0 && <Empty icon="🔍" title="Nothing matches" />}
        {paged.rows.map(({ row: g, target, folderRow, inherited }) => {
          const expanded = open.has(g.key)
          const it0 = g.items[0]
          const src = inherited ? a.byId.get(it0.sourceId) : null
          const gf = a.byId.get(g.sourceId || g.fileId)
          return (
            <div key={g.key}>
              <div className="flex items-center gap-3 px-5 py-2.5">
                {folderRow
                  ? <button onClick={() => setOpen((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })} className="w-7 h-7 grid place-items-center rounded-lg text-ink2 hover:bg-surface2 hover:text-ink" title={expanded ? 'Collapse' : 'Show what is inside'}><Chevron open={expanded} /></button>
                  : <span className="w-7" />}
                <div className="flex-1 min-w-0">
                  <button onClick={() => openFile(g.sourceId || g.fileId)} className="block w-full text-left" title="Open sharing settings">
                    <FileCell name={g.name} mimeType={g.mimeType} sensitive={!folderRow && it0?.sensitive} {...folderProps(a, gf, openFolder)}
                      sub={folderRow ? false : inherited ? `via 📁 ${src?.name || 'a parent folder'}` : undefined} />
                  </button>
                  {folderRow && (
                    <button onClick={() => setOpen((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })} className="ml-7 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                      <Chevron open={expanded} size={12} /> {expanded ? 'Hide' : 'Show'} {fmt(g.items.length)} {g.items.length === 1 ? 'item' : 'items'} inside
                    </button>
                  )}
                </div>
                {it0?.ageDays != null && <span className="num text-xs text-ink3 w-10 text-right hidden sm:block" title="last activity">{ageLabel(it0.ageDays)}</span>}
                <RoleBadge role={g.role} />
                {g.perm?.expirationTime && <Tag color="slate" title={`Expires ${new Date(g.perm.expirationTime).toLocaleDateString()}`}>⏳</Tag>}
                <RowActions target={target} busy={busy} onAct={run} />
              </div>
              {expanded && (
                <div className="pl-12 pr-5 pb-3 max-h-64 overflow-y-auto">
                  {g.items.slice(0, 300).map((it) => (
                    <button key={it.fileId + it.permissionId} onClick={() => openFile(it.fileId)} className="w-full flex items-center gap-3 py-1.5 text-left hover:bg-surface2 rounded-lg px-2">
                      <div className="flex-1 min-w-0"><FileCell name={it.name} mimeType={it.mimeType} sensitive={it.sensitive} /></div>
                      <span className="num text-xs text-ink3">{ageLabel(it.ageDays)}</span>
                    </button>
                  ))}
                  {g.items.length > 300 && <div className="text-xs text-ink3 px-2 py-1">…and {fmt(g.items.length - 300)} more</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Pager paged={paged} className="px-5 py-3 border-t border-line" />
    </Modal>
  )
}

/* ============================== File ============================== */

const whoLabel = (p) =>
  p.type === 'anyone' ? 'anyone with the link'
    : p.type === 'domain' ? `everyone at ${p.domain || 'a domain'}`
    : p.type === 'group' ? (p.email || 'a group')
    : p.isMe ? 'you' : p.deleted ? 'a deleted account' : 'a person'

export function FileDrawer({ file: f, a, onClose, act, busy, openPerson, openFile, openFolder, goInside, onTransfer, igSet, ignore, unignore }) {
  const personByKey = useMemo(() => new Map(a.people.map((p) => [p.key, p])), [a.people])
  const path = useMemo(() => {
    const out = []
    let id = f.parents?.[0]
    for (let i = 0; id && i < 8; i++) {
      const p = a.byId.get(id)
      if (!p) { out.unshift({ id, name: '…', known: false }); break }
      out.unshift({ id: p.id, name: p.name, known: true })
      id = p.parents?.[0]
    }
    return out
  }, [f, a])
  const [hist, setHist] = useState(null)
  useEffect(() => setHist(null), [f.id])

  const rows = useMemo(() => f._items.map((it) => {
    const person = personByKey.get(it.personKey)
    const inherited = !it.direct && it.sourceId !== it.fileId
    return { it, person, inherited, src: inherited ? a.byId.get(it.sourceId) : null, target: targetFor(it, person) }
  }).sort((x, y) => (LEVEL_INFO[y.it.level].rank - LEVEL_INFO[x.it.level].rank) || ((ROLE_RANK[y.it.role] || 0) - (ROLE_RANK[x.it.role] || 0))), [f, a, personByKey])
  const owner = rows.find((r) => r.it.role === 'owner')
  const others = rows.filter((r) => r.it.role !== 'owner')
  const targets = useMemo(() => dedupe(others.map((r) => r.target)), [others])
  const run = (action, ts) => act(action, dedupe(ts).filter((g) => applicableActions(g.perm, { removable: g.removable, mine: g.mine }).includes(action)), { label: f.name })

  async function loadHistory() {
    setHist('loading')
    try { setHist(await api.history(f.id)) } catch (e) { setHist({ error: e.message || 'Could not load history.' }) }
  }

  return (
    <Modal open onClose={onClose} wide>
      <DrawerHead onClose={onClose}>
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none mt-0.5">{fileIcon(f.mimeType)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold text-ink break-words">{f.name}</h2>
            <div className="text-xs text-ink3 mt-0.5 flex flex-wrap items-center gap-x-1">
              {path.length > 0 && <span>📁</span>}
              {path.map((p, i) => (
                <React.Fragment key={p.id}>
                  {p.known
                    ? <button onClick={() => openFile(p.id)} className="hover:text-brand hover:underline" title={`Open folder: ${p.name}`}>{p.name}</button>
                    : <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(p.id)}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand hover:underline" title="This folder was not part of the scan. Open it in Drive.">{p.name} ↗</a>}
                  {i < path.length - 1 && <span>›</span>}
                </React.Fragment>
              ))}
              {path.length > 0 && <span>·</span>}
              <span className="text-ink2">{f._type}</span>
              {f._ageDays != null && <span>· last activity {ageLabel(f._ageDays)} ago</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <LevelTag level={f._level} />
              {f._discoverable && <Tag color="red">Findable on the web</Tag>}
              {f._externalEditors > 0 && <Tag color="amber">{fmt(f._externalEditors)} external editor{f._externalEditors > 1 ? 's' : ''}</Tag>}
              {f._sensitive && <Tag color="pink" title={f._sens.hits?.join(', ')}>Looks sensitive: {f._sens.hits?.slice(0, 3).join(', ')}</Tag>}
              {f._stale && f._others > 0 && <Tag color="slate">Stale</Tag>}
              {f._pendingOwner && <Tag color="slate">Ownership transfer pending</Tag>}
              {f._link && <a href={f._link} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs">Open in Drive ↗</a>}
              {f.ownedByMe && onTransfer && (
                <button onClick={() => onTransfer([f])} className="btn-ghost text-xs" title={f.mimeType === FOLDER ? 'Hand this folder and everything inside it to another Google account' : 'Hand this file to another Google account'}>👑 Transfer ownership…</button>
              )}
              {f.parents?.[0] && openFolder && (
                <button onClick={() => openFolder(f)} className="btn-ghost text-xs" title={path[path.length - 1]?.known ? `Open folder: ${path[path.length - 1].name}` : 'Open the folder in Drive'}>
                  📁 Open folder{!path[path.length - 1]?.known ? ' ↗' : ''}
                </button>
              )}
              {igSet?.has(ignoreKey.file(f.id))
                ? <button onClick={() => unignore(ignoreKey.file(f.id))} className="btn-outline text-xs">🙈 Ignored · undo</button>
                : <button onClick={() => ignore({ key: ignoreKey.file(f.id), kind: 'file', label: f.name })} className="btn-ghost text-xs" title={f.mimeType === FOLDER ? 'Intentionally shared: hide this folder and everything inside from leaks and the score' : 'Intentionally shared: hide this file from leaks and the score'}>🙈 Ignore</button>}
              {f._ignored && !igSet?.has(ignoreKey.file(f.id)) && <Tag color="slate" title="Ignored through a folder or person rule">ignored</Tag>}
            </div>
          </div>
        </div>
      </DrawerHead>

      {f._covers > 0 && (
        <div className="px-5 py-3 bg-brand-soft/60 border-b border-line flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink">📁 Access set here flows down to <b className="num">{fmt(f._covers)}</b> items inside.</span>
          <button onClick={() => goInside(f.id)} className="btn-outline ml-auto">See what's inside →</button>
        </div>
      )}

      {others.some((r) => r.target.removable || r.target.mine) && (
        <div className="px-5 py-3 bg-surface2 border-b border-line flex flex-wrap items-center gap-3">
          <BulkBar targets={targets} actions={others.some((r) => r.target.mine) ? ['accept-owner'] : ['remove', 'downgrade', 'expire']} busy={busy} onRun={run} noun="people" />
          {others.some((r) => r.inherited) && <span className="text-xs text-ink3 ml-auto">Inherited access is changed on its folder.</span>}
        </div>
      )}

      <div className="max-h-[55vh] overflow-y-auto">
        <div className="divide-y divide-line">
          {owner && (
            <div className="flex items-center gap-3 px-5 py-2.5">
              <Avatar name={owner.person?.name || 'Owner'} photo={owner.person?.photo} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink truncate">{owner.person?.name || owner.it.perm.displayName || owner.it.perm.emailAddress}</div>
                <div className="text-xs text-ink3 truncate">{owner.it.perm.emailAddress}</div>
              </div>
              <RoleBadge role="owner" />
            </div>
          )}
          {others.length === 0 && <Empty icon="🔒" title="Only you" sub="Nobody else has access to this item." />}
          {others.map(({ it, person, inherited, src, target }) => (
            <div key={it.permissionId} className="flex items-center gap-3 px-5 py-2.5">
              <button onClick={() => person && openPerson(person.key)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Avatar name={person?.name || it.perm.displayName} photo={person?.photo} kind={person?.kind} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink truncate flex items-center gap-1.5">
                    <span className="truncate">{it.mine ? 'You' : person?.name || it.perm.displayName || it.perm.emailAddress || it.perm.type}</span>
                    {person?.external && person.kind !== 'anyone' && <Tag color="amber">ext</Tag>}
                    {person?.personalEmail && <Tag color="amber">personal</Tag>}
                    {it.perm.allowFileDiscovery && <Tag color="red">web</Tag>}
                    {it.perm.pendingOwner && <Tag color="violet" title={it.mine ? 'You have been offered ownership of this file' : 'Offered ownership; waiting for them to accept'}>{it.mine ? 'offered to you' : 'pending owner'}</Tag>}
                  </div>
                  <div className="text-xs text-ink3 truncate">
                    {person?.email || person?.domain || ''}
                    {inherited && <span> · via 📁 {src ? <button onClick={(e) => { e.stopPropagation(); openFile(src.id) }} className="hover:underline">{src.name}</button> : 'a parent folder'}</span>}
                    {it.perm.expirationTime && <span> · expires {new Date(it.perm.expirationTime).toLocaleDateString()}</span>}
                  </div>
                </div>
              </button>
              <RoleBadge role={it.role} />
              <RowActions target={target} busy={busy} onAct={run} />
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-line">
          <Section title="Sharing timeline" right={hist == null && <button onClick={loadHistory} className="btn-outline">Load history</button>}>
            {hist == null && (
              <p className="text-xs text-ink3">Who shared this, and when. {a.demo ? 'Demo data.' : 'Uses Google’s Drive Activity API, read-only. You’ll be asked once for that extra permission.'}</p>
            )}
            {hist === 'loading' && <div className="flex items-center gap-2 text-sm text-ink2"><Spinner /> Loading…</div>}
            {hist?.error && <div className="text-sm text-danger">{hist.error}</div>}
            {Array.isArray(hist) && hist.length === 0 && <div className="text-sm text-ink3">No sharing changes recorded.</div>}
            {Array.isArray(hist) && hist.length > 0 && (
              <ol className="relative border-l border-line ml-2 space-y-3">
                {hist.map((ev, i) => (
                  <li key={i} className="pl-4">
                    <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-brand" />
                    <div className="text-xs text-ink3">{ev.at ? `${new Date(ev.at).toLocaleDateString()} · ${ago(ev.at)}` : '—'} · {ev.actorIsMe ? 'you' : 'someone else'}</div>
                    <div className="text-sm text-ink">
                      {ev.added.map((p, j) => <div key={'a' + j}><span className="text-ok font-semibold">+</span> {ROLE_LABEL[p.role] || p.role} for {whoLabel(p)}</div>)}
                      {ev.removed.map((p, j) => <div key={'r' + j}><span className="text-danger font-semibold">−</span> {ROLE_LABEL[p.role] || p.role} for {whoLabel(p)}</div>)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </Modal>
  )
}

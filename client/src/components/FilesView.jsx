import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { LEVELS, LEVEL_INFO, AGE_BUCKETS, ageBucket, FOLDER } from '../lib/analyze.js'
import { Avatar, Tag, FileCell, Pager, usePaged, Empty, LevelDot, Checkbox, folderProps, fmt, ageLabel } from './ui.jsx'
import { MiniBar } from './charts.jsx'

const SORT = [['risk', 'Highest risk'], ['people', 'Most people'], ['covers', 'Widest folders'], ['old', 'Oldest activity'], ['new', 'Newest activity'], ['name', 'Name']]

export default function FilesView({ a, onOpen, onFolder, onTransfer, initial, folderId, onClearFolder }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set()) // file ids picked for a transfer (owned pool)
  const canPick = a.scope === 'owned' && Boolean(onTransfer)
  useEffect(() => setSel(new Set()), [folderId, a.scope, a.scannedAt])
  const [level, setLevel] = useState(initial?.level || 'shared') // shared | all | <level>
  const [type, setType] = useState('any')
  const [age, setAge] = useState(initial?.age || 'any')
  const [sensitive, setSensitive] = useState(false)
  const [foldersOnly, setFoldersOnly] = useState(false)
  const [sort, setSort] = useState('risk')
  useEffect(() => { if (initial) { setLevel(initial.level || 'shared'); setAge(initial.age || 'any') } }, [initial])
  const dq = useDeferredValue(q)

  const list = useMemo(() => {
    const needle = dq.toLowerCase()
    const out = a.files.filter((f) => {
      if (folderId) {
        const pid = f.parents?.[0]
        if (folderId === '__root__' ? (pid && a.byId.has(pid)) : pid !== folderId) return false
      }
      if (level === 'shared' && (!f._others || f._ignored)) return false
      if (level === 'ignored' && !f._ignored) return false
      if (level !== 'shared' && level !== 'all' && level !== 'ignored' && f._level !== level) return false
      if (type !== 'any' && f._type !== type) return false
      if (age !== 'any' && ageBucket(f._ageDays) !== age) return false
      if (sensitive && !f._sensitive) return false
      if (foldersOnly && !(f.mimeType === FOLDER && f._others)) return false
      if (needle && !f.name.toLowerCase().includes(needle)) return false
      return true
    })
    const by = {
      risk: (x, y) => y._risk - x._risk || y._others - x._others,
      people: (x, y) => y._others - x._others,
      covers: (x, y) => y._covers - x._covers || y._others - x._others,
      old: (x, y) => (y._ageDays ?? -1) - (x._ageDays ?? -1),
      new: (x, y) => (x._ageDays ?? 1e9) - (y._ageDays ?? 1e9),
      name: (x, y) => x.name.localeCompare(y.name),
    }[sort]
    return out.sort(by)
  }, [a.files, a.byId, folderId, level, type, age, sensitive, foldersOnly, sort, dq])
  const paged = usePaged(list, 100)
  const maxRisk = Math.max(1, ...list.slice(0, 200).map((f) => f._risk))
  const folder = folderId === '__root__' ? { name: 'My Drive (top level)' } : folderId && a.byId.get(folderId)
  const toggle = (id, on) => setSel((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })
  const allShownOn = list.length > 0 && list.every((f) => sel.has(f.id))
  const picked = useMemo(() => [...sel].map((id) => a.byId.get(id)).filter((f) => f && f.ownedByMe), [sel, a.byId])

  return (
    <div className="space-y-3">
      <div className="card p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files & folders…" className="input flex-1" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="select">{SORT.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}</select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 bg-surface2 rounded-lg p-1 overflow-x-auto">
            <button onClick={() => setLevel('shared')} className={level === 'shared' ? 'chip-on' : 'chip-off'}>Shared</button>
            {LEVELS.slice().reverse().filter((l) => l !== 'private').map((l) => (
              <button key={l} onClick={() => setLevel(l)} className={level === l ? 'chip-on' : 'chip-off'}>
                <LevelDot level={l} size={8} /> {LEVEL_INFO[l].short} <span className="num opacity-60">{fmt(a.levelCounts[l])}</span>
              </button>
            ))}
            <button onClick={() => setLevel('all')} className={level === 'all' ? 'chip-on' : 'chip-off'}>All</button>
            {a.totals.ignoredFiles > 0 && <button onClick={() => setLevel('ignored')} className={level === 'ignored' ? 'chip-on' : 'chip-off'}>🙈 Ignored <span className="num opacity-60">{fmt(a.totals.ignoredFiles)}</span></button>}
          </div>
          <select value={type} onChange={(e) => setType(e.target.value)} className="select">
            <option value="any">Any type</option>
            {a.typeCounts.map((t) => <option key={t.type} value={t.type}>{t.type} ({fmt(t.count)})</option>)}
          </select>
          <select value={age} onChange={(e) => setAge(e.target.value)} className="select">
            <option value="any">Any age</option>
            {AGE_BUCKETS.map((b) => <option key={b} value={b}>Last activity {b}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-ink2 cursor-pointer"><input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} className="accent-[rgb(var(--brand))]" /> Sensitive names</label>
          <label className="inline-flex items-center gap-1.5 text-sm text-ink2 cursor-pointer"><input type="checkbox" checked={foldersOnly} onChange={(e) => setFoldersOnly(e.target.checked)} className="accent-[rgb(var(--brand))]" /> Shared folders only</label>
          <span className="text-xs text-ink3 num ml-auto">{fmt(list.length)} items</span>
        </div>
        {folder && (
          <div className="flex items-center gap-2 text-sm">
            <Tag color="blue">📁 inside {folder.name}</Tag>
            <button onClick={onClearFolder} className="btn-ghost">× clear</button>
          </div>
        )}
        {canPick && (
          <div className="flex flex-wrap items-center gap-2 text-sm pt-1 border-t border-line">
            <Checkbox checked={allShownOn} indeterminate={!allShownOn && sel.size > 0} onChange={(on) => setSel(on ? new Set(list.map((f) => f.id)) : new Set())}
              label={sel.size ? `${fmt(sel.size)} selected` : `Select all shown (${fmt(list.length)})`} />
            <div className="flex-1" />
            <button onClick={() => onTransfer(picked)} disabled={picked.length === 0} className="btn-outline" title="Hand the selected files, and everything inside selected folders, to another Google account">
              👑 Transfer ownership…{picked.length ? ` (${fmt(picked.length)})` : ''}
            </button>
            {sel.size > 0 && <button onClick={() => setSel(new Set())} className="btn-ghost">Clear</button>}
          </div>
        )}
      </div>

      <div className="card divide-y divide-line overflow-hidden">
        {list.length === 0 && <Empty icon="🔍" title="No files match" sub="Try fewer filters." />}
        {paged.rows.map((f) => (
          <div key={f.id} className={`flex items-center ${sel.has(f.id) ? 'bg-brand-soft/40' : ''}`}>
          {canPick && <div className="pl-3 sm:pl-4"><Checkbox checked={sel.has(f.id)} onChange={(on) => toggle(f.id, on)} /></div>}
          <button onClick={() => onOpen(f.id)} className="flex-1 min-w-0 flex items-center gap-3 p-3 sm:px-4 hover:bg-surface2 text-left">
            <LevelDot level={f._level} />
            <div className="flex-1 min-w-0">
              <FileCell name={f.name} mimeType={f.mimeType} sensitive={f._sensitive} hits={f._sens.hits} {...folderProps(a, f, onFolder)}
                sub={`${f._type}${f._covers ? ` · sharing reaches ${fmt(f._covers)} inside` : ''}${f._ageDays != null ? ` · ${ageLabel(f._ageDays)} ago` : ''}`} />
            </div>
            <div className="hidden md:flex items-center gap-1.5">
              {f._ignored && <Tag color="slate">ignored</Tag>}
              {f._discoverable && <Tag color="red">Findable on web</Tag>}
              {f._public && !f._discoverable && <Tag color="red">Public link</Tag>}
              {f._externalEditors > 0 && <Tag color="amber">{fmt(f._externalEditors)} ext. editor{f._externalEditors > 1 ? 's' : ''}</Tag>}
              {f._external && !f._externalEditors && <Tag color="amber">External</Tag>}
              {f._domain && <Tag color="violet">Domain</Tag>}
              {f._stale && f._others > 0 && <Tag color="slate">Stale</Tag>}
              {f._expiring && <Tag color="slate">⏳</Tag>}
            </div>
            <div className="flex -space-x-2 shrink-0">
              {f._items.filter((i) => i.role !== 'owner').slice(0, 4).map((i) => (
                <div key={i.permissionId} className="ring-2 ring-surface rounded-full">
                  <Avatar name={i.perm.displayName || i.perm.emailAddress} photo={i.perm.photoLink} kind={i.perm.type === 'anyone' ? 'anyone' : i.perm.type === 'domain' ? 'domain' : i.perm.type === 'group' ? 'group' : 'user'} size={26} />
                </div>
              ))}
            </div>
            <div className="text-right w-20 shrink-0">
              <div className="num font-bold text-ink">{fmt(f._others)}</div>
              <div className="text-[11px] text-ink3">shared with</div>
            </div>
            <div className="w-16 hidden lg:block" title={`risk ${f._risk}`}><MiniBar value={f._risk} max={maxRisk} color={LEVEL_INFO[f._level].color} /></div>
            <span className="text-ink3">›</span>
          </button>
          </div>
        ))}
      </div>
      <Pager paged={paged} />
    </div>
  )
}

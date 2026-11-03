import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Avatar, RoleBadge, Tag, Pager, usePaged, Empty, LevelDot, fmt, ago } from './ui.jsx'
import { MiniBar } from './charts.jsx'

const WHO = [
  ['all', 'Everyone'],
  ['external', 'External'],
  ['internal', 'Internal'],
  ['public', 'Public & domain'],
  ['group', 'Groups'],
  ['personal', 'Personal email'],
]
const ROLE = [['any', 'Any role'], ['edit', 'Can edit'], ['view', 'View / comment only']]
const ACT = [['any', 'Any activity'], ['stale', 'Stale (> 1 year)'], ['recent', 'Active (< 90 days)']]
const SORT = [['items', 'Most items'], ['edit', 'Most editing'], ['sensitive', 'Most sensitive'], ['stale', 'Most stale'], ['recent', 'Most recent'], ['name', 'Name']]

export default function PeopleView({ a, onOpen, initial }) {
  const [q, setQ] = useState(initial?.q || '')
  const [who, setWho] = useState(initial?.filter || 'all')
  const [role, setRole] = useState('any')
  const [activity, setActivity] = useState('any')
  const [sort, setSort] = useState('items')
  const [domain, setDomain] = useState('')
  useEffect(() => { if (initial) { setQ(initial.q || ''); setWho(initial.filter || 'all') } }, [initial])
  const dq = useDeferredValue(q)

  const list = useMemo(() => {
    const needle = dq.toLowerCase()
    const out = a.people.filter((p) => {
      if (who === 'external' && !p.external) return false
      if (who === 'internal' && (p.external || p.kind === 'anyone' || p.kind === 'domain')) return false
      if (who === 'public' && p.kind !== 'anyone' && p.kind !== 'domain') return false
      if (who === 'group' && p.kind !== 'group') return false
      if (who === 'personal' && !p.personalEmail) return false
      if (role === 'edit' && !p.editorFiles) return false
      if (role === 'view' && p.editorFiles) return false
      if (activity === 'stale' && !(p.lastTouched && Date.now() - p.lastTouched > 365 * 864e5)) return false
      if (activity === 'recent' && !(p.lastTouched && Date.now() - p.lastTouched < 90 * 864e5)) return false
      if (domain && p.domain !== domain) return false
      if (needle) {
        const hay = `${p.name} ${p.email || ''} ${p.domain || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const by = {
      items: (x, y) => y.files.length - x.files.length,
      edit: (x, y) => y.editorFiles - x.editorFiles || y.files.length - x.files.length,
      sensitive: (x, y) => y.sensitiveFiles - x.sensitiveFiles || y.files.length - x.files.length,
      stale: (x, y) => y.staleFiles - x.staleFiles || y.files.length - x.files.length,
      recent: (x, y) => y.lastTouched - x.lastTouched,
      name: (x, y) => x.name.localeCompare(y.name),
    }[sort]
    return out.sort(by)
  }, [a.people, who, role, activity, domain, sort, dq])
  const paged = usePaged(list, 100)
  const maxItems = list[0] ? Math.max(...list.slice(0, 200).map((p) => p.files.length), 1) : 1
  const domains = a.domains.filter((d) => d.external).slice(0, 30)

  return (
    <div className="space-y-3">
      <div className="card p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, emails, domains…" className="input flex-1" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="select">{SORT.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}</select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 bg-surface2 rounded-lg p-1 overflow-x-auto">
            {WHO.map(([k, l]) => <button key={k} onClick={() => setWho(k)} className={who === k ? 'chip-on' : 'chip-off'}>{l}</button>)}
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="select">{ROLE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className="select">{ACT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {domains.length > 0 && (
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="select">
              <option value="">Any domain</option>
              {domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain} ({d.people})</option>)}
            </select>
          )}
          <span className="text-xs text-ink3 num ml-auto">{fmt(list.length)} {list.length === 1 ? 'person' : 'people'}</span>
        </div>
      </div>

      <div className="card divide-y divide-line overflow-hidden">
        {list.length === 0 && <Empty icon="🔍" title="No one matches" sub="Try fewer filters." />}
        {paged.rows.map((p) => (
          <button key={p.key} onClick={() => onOpen(p)} className="w-full flex items-center gap-3 p-3 sm:px-4 hover:bg-surface2 text-left">
            <Avatar name={p.name} photo={p.photo} kind={p.kind} size={40} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ink truncate flex items-center gap-2">
                <LevelDot level={p.level} size={8} />
                <span className="truncate">{p.name}</span>
              </div>
              <div className="text-xs text-ink3 truncate">
                {p.email || p.domain || '—'}
                {p.lastTouched ? <span> · last activity {ago(p.lastTouched)}</span> : null}
              </div>
              <div className="mt-1.5 w-40 hidden sm:block"><MiniBar value={p.files.length} max={maxItems} color={p.external || p.kind === 'anyone' ? 'var(--c-external)' : 'var(--c-internal)'} /></div>
            </div>
            <div className="hidden md:flex items-center gap-1.5">
              {p.ignored && <Tag color="slate">ignored</Tag>}
              {!p.ignored && p.ignoredFiles > 0 && <Tag color="slate">{fmt(p.ignoredFiles)} ignored</Tag>}
              {p.kind === 'anyone' && <Tag color="red">Public</Tag>}
              {p.kind === 'domain' && <Tag color="violet">Domain</Tag>}
              {p.external && p.kind !== 'anyone' && <Tag color="amber">External</Tag>}
              {p.personalEmail && <Tag color="amber">Personal</Tag>}
              {p.kind === 'group' && <Tag color="blue">Group</Tag>}
              {p.sensitiveFiles > 0 && <Tag color="pink" title="Items whose names look sensitive">{fmt(p.sensitiveFiles)} sensitive</Tag>}
              {p.staleFiles > 0 && <Tag color="slate" title="Items untouched for over a year">{fmt(p.staleFiles)} stale</Tag>}
            </div>
            <RoleBadge role={p.topRole} />
            <div className="text-right w-16">
              <div className="num font-bold text-ink">{fmt(p.files.length)}</div>
              <div className="text-[11px] text-ink3">{p.editorFiles ? `${fmt(p.editorFiles)} edit` : 'items'}</div>
            </div>
            <span className="text-ink3">›</span>
          </button>
        ))}
      </div>
      <Pager paged={paged} />
    </div>
  )
}

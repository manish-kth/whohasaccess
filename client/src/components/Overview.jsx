import React from 'react'
import { LEVELS, LEVEL_INFO, AGE_BUCKETS } from '../lib/analyze.js'
import { ScoreDial, Donut, Bars, Columns } from './charts.jsx'
import { Avatar, Tag, fmt, ago } from './ui.jsx'

const ISSUE_META = {
  'public-web': { icon: '🔎', title: 'Findable on the web', sub: 'public links that search engines can index', tone: 'danger' },
  'public-link': { icon: '🔗', title: 'Public links', sub: 'anyone with the link can open', tone: 'danger' },
  'sensitive-exposed': { icon: '🩸', title: 'Sensitive & exposed', sub: 'names look sensitive, shared outside', tone: 'pink' },
  'external-editors': { icon: '✏️', title: 'External editors', sub: 'outside people who can edit', tone: 'warn' },
  'stale-external': { icon: '🕰️', title: 'Stale external shares', sub: 'untouched for over a year', tone: 'warn' },
  'personal-email': { icon: '📧', title: 'Personal email accounts', sub: 'gmail, outlook and the like', tone: 'warn' },
  'domain-wide': { icon: '🏢', title: 'Domain-wide links', sub: 'everyone in a domain', tone: 'violet' },
  'expiring': { icon: '⏳', title: 'Expiring access', sub: 'ends by itself', tone: 'slate' },
  'pending-owner': { icon: '🔁', title: 'Pending ownership transfers', sub: 'waiting on someone to accept', tone: 'slate' },
}
export { ISSUE_META }

function LeakTile({ k, count, onClick }) {
  const m = ISSUE_META[k]
  const tone = count === 0 ? 'ok' : m.tone
  const ring = { danger: 'hover:ring-danger', pink: 'hover:ring-pink-400', warn: 'hover:ring-warn', violet: 'hover:ring-violet', slate: 'hover:ring-brand', ok: 'hover:ring-ok' }[tone]
  const num = { danger: 'text-danger', pink: 'text-pink-600 dark:text-pink-300', warn: 'text-warn', violet: 'text-violet', slate: 'text-ink', ok: 'text-ok' }[tone]
  return (
    <button onClick={onClick} className={`card text-left p-4 transition ${ring} hover:shadow-pop`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xl leading-none">{m.icon}</span>
        {count === 0 ? <Tag color="green">clear</Tag> : null}
      </div>
      <div className={`num text-3xl font-extrabold mt-2 ${num}`}>{fmt(count)}</div>
      <div className="text-sm font-semibold text-ink mt-0.5">{m.title}</div>
      <div className="text-xs text-ink3">{m.sub}</div>
    </button>
  )
}

export default function Overview({ a, drift, goIssue, goPeople, goFiles, openPerson, goMap, openIgnores }) {
  const t = a.totals
  const s = a.score
  const dialColor = s.value >= 75 ? 'var(--c-private)' : s.value >= 50 ? 'var(--c-external)' : 'var(--c-public)'
  const headline = s.value >= 90 ? 'Your Drive looks tight.' : s.value >= 75 ? 'A few things to tidy.' : s.value >= 50 ? 'There are real leaks here.' : 'Your Drive is wide open.'

  const donut = LEVELS.slice().reverse().filter((l) => l !== 'private').map((l) => ({
    key: l, label: LEVEL_INFO[l].short, value: a.levelCounts[l], color: LEVEL_INFO[l].color,
  }))
  const domains = a.domains.filter((d) => d.external).slice(0, 8).map((d) => ({
    key: d.domain, label: d.domain, value: d.files, color: d.personalEmail ? 'var(--c-external)' : 'var(--c-domain)',
    sub: `${fmt(d.people)} ${d.people === 1 ? 'person' : 'people'}${d.editors ? ` · ${fmt(d.editors)} editing` : ''}`,
  }))
  const age = AGE_BUCKETS.map((b, i) => ({ key: b, label: b, value: a.ageCounts[b], color: i >= 3 ? 'var(--c-stale)' : 'var(--c-internal)' }))
  const riskPeople = a.people.filter((p) => p.external || p.kind === 'anyone')
    .sort((x, y) => (y.editorFiles * 3 + y.sensitiveFiles * 4 + y.files.length * 0.01) - (x.editorFiles * 3 + x.sensitiveFiles * 4 + x.files.length * 0.01))
    .slice(0, 6)

  return (
    <div className="space-y-5">
      {drift && (drift.newShares.length > 0 || drift.newlyPublic > 0 || drift.prevScore !== s.value) && (
        <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 ring-brand/40">
          <div className="font-semibold text-ink">Since your last scan <span className="text-ink3 font-normal">({ago(drift.since)})</span></div>
          <div className="text-sm text-ink2 num">Score {drift.prevScore} → <b className={s.value < drift.prevScore ? 'text-danger' : 'text-ok'}>{s.value}</b></div>
          <div className="text-sm text-ink2 num"><b className={drift.newShares.length ? 'text-warn' : 'text-ink'}>{fmt(drift.newShares.length)}</b> new shares</div>
          <div className="text-sm text-ink2 num"><b className={drift.newlyPublic ? 'text-danger' : 'text-ink'}>{fmt(drift.newlyPublic)}</b> newly public</div>
          <div className="text-sm text-ink2 num"><b>{fmt(drift.newPeople.length)}</b> new people</div>
          <div className="text-sm text-ink2 num"><b className="text-ok">{fmt(drift.removedShares.length)}</b> shares removed</div>
        </div>
      )}

      <div className="card hero p-6 grid lg:grid-cols-[auto,1fr,1fr] gap-6 items-center">
        <ScoreDial value={s.value} grade={s.grade} color={dialColor} label="security score" size={170} />
        <div>
          <h2 className="text-2xl font-extrabold text-ink leading-tight">{headline}</h2>
          <p className="text-sm text-ink2 mt-2 max-w-md">
            {a.scope === 'owned' ? 'You own' : 'Others shared'} <b className="num">{fmt(t.files)}</b> items{a.scope === 'shared' ? ' with you' : ''}.{' '}
            <b className="num">{fmt(t.shared)}</b> are shared with someone else, <b className="num text-danger">{fmt(t.publicFiles)}</b> are public, and{' '}
            <b className="num text-warn">{fmt(t.external)}</b> external {t.external === 1 ? 'person' : 'people'} can get in.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => goIssue()} className="btn-primary">🩹 Fix leaks</button>
            <button onClick={goMap} className="btn-outline">🗺️ Where the leaks live</button>
            <button onClick={() => goPeople()} className="btn-ghost">Everyone with access →</button>
          </div>
        </div>
        <div className="lg:border-l lg:border-line lg:pl-6">
          <div className="text-xs font-bold uppercase tracking-wide text-ink3 mb-2">What moves the needle</div>
          {s.penalties.length === 0 ? (
            <div className="text-sm text-ok font-medium">Nothing is pulling your score down. 🎉</div>
          ) : (
            <ul className="space-y-1.5">
              {s.penalties.slice(0, 5).map((p) => (
                <li key={p.key}>
                  <button onClick={() => goIssue(p.key)} className="w-full flex items-center gap-3 text-left group">
                    <span className="num text-sm font-bold text-danger w-10 shrink-0">−{p.points}</span>
                    <span className="text-sm text-ink group-hover:text-brand flex-1 truncate">{p.label}</span>
                    <span className="num text-xs text-ink3">{fmt(a.issues[p.key].items.length)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {['public-web', 'public-link', 'sensitive-exposed', 'external-editors', 'stale-external', 'personal-email'].map((k) => (
          <LeakTile key={k} k={k} count={a.issues[k].items.length} onClick={() => goIssue(k)} />
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="font-bold text-ink">Exposure mix</div>
          <div className="text-xs text-ink3 mb-3">shared items by their widest audience</div>
          <Donut segments={donut} center={fmt(t.shared)} sub="shared" onSelect={(k) => goFiles({ level: k })} />
        </div>
        <div className="card p-5">
          <div className="font-bold text-ink">Outside domains</div>
          <div className="text-xs text-ink3 mb-3">items reachable per external domain</div>
          <Bars rows={domains} onSelect={(k) => goPeople({ q: '@' + k })} />
          {domains.length === 0 && <div className="text-sm text-ink3 py-6 text-center">No external domains.</div>}
        </div>
        <div className="card p-5">
          <div className="font-bold text-ink">How old are the shares?</div>
          <div className="text-xs text-ink3 mb-3">last activity on shared items · grey = stale</div>
          <Columns buckets={age} onSelect={(k) => goFiles({ age: k })} />
        </div>
      </div>

      {riskPeople.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-bold text-ink">Worth a look</div>
              <div className="text-xs text-ink3">outside people with the most reach</div>
            </div>
            <button onClick={() => goPeople({ filter: 'external' })} className="btn-ghost">All external →</button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {riskPeople.map((p) => (
              <button key={p.key} onClick={() => openPerson(p.key)} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface2 text-left ring-1 ring-transparent hover:ring-line">
                <Avatar name={p.name} photo={p.photo} kind={p.kind} size={38} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink truncate">{p.name}</div>
                  <div className="text-xs text-ink3 truncate">{p.email || p.domain}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-bold text-ink">{fmt(p.files.length)}</div>
                  <div className="text-[11px] text-ink3">
                    {p.editorFiles ? `${fmt(p.editorFiles)} edit` : p.sensitiveFiles ? `${fmt(p.sensitiveFiles)} sensitive` : 'items'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {(t.expiring > 0 || t.pendingOwner > 0 || t.domainWide > 0 || t.ignored > 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {t.ignored > 0 && <button onClick={openIgnores} className="btn-outline" title="Marked as intentionally shared; not counted">🙈 {fmt(t.ignored)} ignored</button>}
          {t.domainWide > 0 && <button onClick={() => goIssue('domain-wide')} className="btn-outline">🏢 {fmt(t.domainWide)} domain-wide</button>}
          {t.expiring > 0 && <button onClick={() => goIssue('expiring')} className="btn-outline">⏳ {fmt(t.expiring)} expiring</button>}
          {t.pendingOwner > 0 && <button onClick={() => goIssue('pending-owner')} className="btn-outline">🔁 {fmt(t.pendingOwner)} pending ownership</button>}
        </div>
      )}
    </div>
  )
}

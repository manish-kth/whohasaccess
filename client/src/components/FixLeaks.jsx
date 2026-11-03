import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ACTIONS, applicableActions } from '../lib/actions.js'
import { ignoreKey } from '../lib/ignores.js'
import { ISSUE_META } from './Overview.jsx'
import { Avatar, RoleBadge, FileCell, Checkbox, Chevron, Pager, usePaged, Empty, Spinner, Tag, folderProps, fmt, ageLabel } from './ui.jsx'

export const ISSUE_ORDER = ['public-web', 'sensitive-exposed', 'public-link', 'external-editors', 'stale-external', 'personal-email', 'domain-wide', 'expiring', 'pending-owner']

const ISSUE_HELP = {
  'public-web': { why: 'These links are set to "anyone on the internet can find and open". Search engines may have indexed them.', recommend: 'restrict', actions: ['restrict', 'remove'] },
  'sensitive-exposed': { why: 'File names here look like identity, money, credentials, legal or medical material, and they are reachable outside your domain. Only the name was checked; contents are never read.', recommend: 'remove', actions: ['remove', 'downgrade', 'expire', 'restrict'] },
  'public-link': { why: 'Anyone who gets hold of the link can open these. Links travel: forwarded emails, chat history, old bookmarks.', recommend: 'remove', actions: ['remove'] },
  'external-editors': { why: 'People outside your domain can change (and re-share) these. Viewer is usually enough.', recommend: 'downgrade', actions: ['downgrade', 'remove', 'expire'] },
  'stale-external': { why: "Shared with outside people, but nobody has touched them in over a year. Old projects, past contractors, finished deals.", recommend: 'remove', actions: ['remove', 'expire', 'downgrade'] },
  'personal-email': { why: 'Personal Gmail/Outlook-style accounts are outside any company control and outlive employment.', recommend: 'remove', actions: ['remove', 'expire', 'downgrade'] },
  'domain-wide': { why: 'Everyone in the domain can open these, including people who joined after you shared.', recommend: 'remove', actions: ['remove'] },
  'expiring': { why: 'These already have an end date. Nothing to do unless you want them gone sooner.', recommend: 'remove', actions: ['remove'] },
  'pending-owner': { why: "You offered ownership of these and the other person hasn't accepted yet. Cancel the invite if it is no longer wanted; they keep editor access.", whyShared: 'Someone offered you ownership of these. Accept to become the owner; they stay on as editor.', recommend: null, actions: ['cancel-invite', 'accept-owner'] },
}

const can = (g, ac) => applicableActions(g.perm, { removable: g.removable, mine: g.mine }).includes(ac)
const btnTone = (ac, rec) => ac === 'remove' ? 'btn-danger' : ac === 'accept-owner' || rec ? 'btn-primary' : 'btn-outline'
const dedupe = (gs) => [...new Map(gs.map((g) => [g.key, g])).values()]

function IssueNav({ a, current, onPick }) {
  return (
    <nav className="space-y-1">
      {ISSUE_ORDER.map((k) => {
        const n = a.issues[k].items.length
        const m = ISSUE_META[k]
        const on = current === k
        return (
          <button key={k} onClick={() => onPick(k)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${on ? 'bg-ink text-bg' : 'hover:bg-surface2 text-ink'}`}>
            <span className="text-lg leading-none w-6 text-center">{m.icon}</span>
            <span className="flex-1 text-sm font-semibold truncate">{m.title}</span>
            <span className={`num text-sm font-bold ${on ? 'text-bg' : n === 0 ? 'text-ok' : m.tone === 'danger' ? 'text-danger' : m.tone === 'warn' ? 'text-warn' : 'text-ink2'}`}>
              {n === 0 ? '✓' : fmt(n)}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function PersonChip({ person, onOpen }) {
  if (!person) return null
  return (
    <button onClick={(e) => { e.stopPropagation(); onOpen(person.key) }} className="flex items-center gap-1.5 min-w-0 hover:underline" title={person.email || person.domain || person.name}>
      <Avatar name={person.name} photo={person.photo} kind={person.kind} size={22} />
      <span className="text-xs text-ink2 truncate max-w-[140px]">{person.name}</span>
    </button>
  )
}

// Quick actions for one or more targets (people on the same folder or file).
function RowActions({ groups, actions, busy, onRun }) {
  const acts = actions.filter((ac) => groups.some((g) => can(g, ac))).slice(0, 2)
  if (!acts.length) return actions.length ? <span className="text-xs text-ink3 px-2" title="Only the owner can change this">—</span> : null
  return (
    <div className="flex gap-1 shrink-0">
      {acts.map((ac) => {
        const n = groups.filter((g) => can(g, ac)).length
        return (
          <button key={ac} onClick={() => onRun(ac, groups)} disabled={!!busy} title={ACTIONS[ac].help}
            className={`${ac === 'remove' ? 'text-danger hover:bg-danger-soft' : ac === 'accept-owner' ? 'text-ok hover:bg-ok-soft' : 'text-warn hover:bg-warn-soft'} px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-40`}>
            {ACTIONS[ac].label}{groups.length > 1 ? ` (${fmt(n)})` : ''}
          </button>
        )
      })}
    </div>
  )
}

export default function FixLeaks({ a, issueKey, setIssueKey, act, busy, openPerson, openFile, openFolder, ignore, openIgnores }) {
  const key = ISSUE_ORDER.includes(issueKey) ? issueKey : ISSUE_ORDER.find((k) => a.issues[k].items.length > 0) || 'public-web'
  const issue = a.issues[key]
  const meta = ISSUE_META[key]
  const help = ISSUE_HELP[key]
  const why = a.scope === 'shared' && help.whyShared ? help.whyShared : help.why
  // A row can be picked when any of this section's actions applies to it.
  const pickable = (g) => help.actions.some((ac) => can(g, ac))
  const [grouped, setGrouped] = useState(true)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set()) // selected target keys
  const [open, setOpen] = useState(() => new Set()) // expanded rows
  const [confirm, setConfirm] = useState(null)
  const dq = useDeferredValue(q)
  const personByKey = useMemo(() => new Map(a.people.map((p) => [p.key, p])), [a.people])

  useEffect(() => { setSel(new Set()); setOpen(new Set()); setConfirm(null) }, [key, a])

  // Rows. By folder: one row per source (the folder or file the access is set
  // on), holding every person who gets in through it. Every item: one row per
  // (file, person); an inherited one still acts on its folder.
  const rows = useMemo(() => {
    let out
    if (grouped) {
      const bySrc = new Map()
      for (const g of issue.groups) {
        let r = bySrc.get(g.sourceId)
        if (!r) { r = { key: 'src:' + g.sourceId, sourceId: g.sourceId, name: g.name, mimeType: g.mimeType, groups: [], seen: new Set(), items: [] }; bySrc.set(g.sourceId, r) }
        r.groups.push(g)
        for (const it of g.items) if (!r.seen.has(it.fileId)) { r.seen.add(it.fileId); r.items.push(it) }
      }
      out = [...bySrc.values()].map((r) => ({ ...r, folderRow: r.items.length > 1 || r.items[0]?.fileId !== r.sourceId }))
      out.sort((x, y) => y.items.length - x.items.length || y.groups.length - x.groups.length)
    } else {
      const byKey = new Map(issue.groups.map((g) => [g.key, g]))
      out = issue.items.map((it) => {
        const inherited = !it.direct && it.sourceId !== it.fileId
        const target = (inherited && byKey.get(`${it.sourceId}|${it.personKey}`)) || { ...it, key: `${it.fileId}|${it.permissionId}`, items: [it] }
        return { key: `${it.fileId}|${it.permissionId}`, sourceId: it.fileId, name: it.name, mimeType: it.mimeType, groups: [target], items: [it], folderRow: false, inherited, via: inherited ? a.byId.get(it.sourceId)?.name || 'a parent folder' : null }
      })
    }
    const needle = dq.toLowerCase()
    return needle ? out.filter((r) => r.name.toLowerCase().includes(needle) || r.items.some((i) => i.name.toLowerCase().includes(needle))) : out
  }, [issue, grouped, dq, a.byId])
  const paged = usePaged(rows, 50)
  const groupedCount = useMemo(() => new Set(issue.groups.map((g) => g.sourceId)).size, [issue])

  const allTargets = useMemo(() => dedupe(rows.flatMap((r) => r.groups)), [rows])
  const actionable = (ac) => allTargets.filter((g) => can(g, ac))
  const selected = allTargets.filter((g) => sel.has(g.key))
  const removableKeys = allTargets.filter(pickable).map((g) => g.key)
  const allOn = removableKeys.length > 0 && removableKeys.every((k) => sel.has(k))
  const toggleAll = (on) => setSel(on ? new Set(removableKeys) : new Set())
  const toggleKeys = (keys, on) => setSel((s) => { const n = new Set(s); for (const k of keys) on ? n.add(k) : n.delete(k); return n })
  const toggleOpen = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const expandableKeys = useMemo(() => rows.filter((r) => r.folderRow || r.groups.length > 1).map((r) => r.key), [rows])
  const allOpen = expandableKeys.length > 0 && expandableKeys.every((k) => open.has(k))

  async function run(action, targets) {
    const ok = dedupe(targets).filter((g) => can(g, action))
    if (!ok.length) return
    setConfirm(null)
    await act(action, ok, { label: meta.title })
    setSel(new Set())
  }

  const allClear = ISSUE_ORDER.every((k) => a.issues[k].items.length === 0)

  return (
    <div className="grid lg:grid-cols-[260px,1fr] gap-5">
      <aside className="card p-3 self-start lg:sticky lg:top-[7.5rem]">
        <div className="px-3 pt-1 pb-2 text-xs font-bold uppercase tracking-wide text-ink3">Leaks, worst first</div>
        <IssueNav a={a} current={key} onPick={setIssueKey} />
      </aside>

      <section className="min-w-0">
        {allClear ? (
          <div className="card"><Empty icon="🎉" title="No leaks found" sub="Nothing public, nothing sensitive outside, no stale or personal-account shares." /></div>
        ) : (
          <div className="card overflow-hidden">
            <div className="p-5 border-b border-line">
              <div className="flex items-start gap-3">
                <span className="text-3xl leading-none">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-extrabold text-ink">{meta.title} <span className="num text-ink3 font-semibold">· {fmt(issue.items.length)}</span></h2>
                  <p className="text-sm text-ink2 mt-1 max-w-2xl">{why}</p>
                  {help.recommend && (
                    <p className="text-sm mt-2"><span className="font-semibold text-ink">Recommended:</span> <span className="text-ink2">{ACTIONS[help.recommend].label}. {ACTIONS[help.recommend].help}</span></p>
                  )}
                  {a.totals.ignored > 0 && (
                    <button onClick={openIgnores} className="mt-2 text-xs text-ink3 hover:text-ink">🙈 {fmt(a.totals.ignored)} ignored {a.totals.ignored === 1 ? 'share is' : 'shares are'} hidden from these lists · manage</button>
                  )}
                </div>
              </div>
            </div>

            {issue.items.length > 0 && help.actions.length > 0 && (
              <div className="px-5 py-3 bg-surface2 flex flex-wrap items-center gap-2 border-b border-line">
                <Checkbox checked={allOn} indeterminate={!allOn && sel.size > 0} onChange={toggleAll} label={sel.size ? `${fmt(sel.size)} selected` : 'Select all'} />
                <div className="flex-1" />
                {busy ? (
                  <div className="flex items-center gap-2 text-sm text-ink2"><Spinner /> {busy.label}… <span className="num">{fmt(busy.done)}/{fmt(busy.total)}</span></div>
                ) : confirm ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink2">{ACTIONS[confirm].label} on <b className="num text-ink">{fmt((sel.size ? selected : actionable(confirm)).filter((g) => can(g, confirm)).length)}</b> {sel.size ? 'selected' : 'shares'}?</span>
                    <button onClick={() => run(confirm, sel.size ? selected : actionable(confirm))} className={confirm === 'remove' ? 'btn-danger' : confirm === 'accept-owner' ? 'btn-primary' : 'btn-warn'}>Confirm</button>
                    <button onClick={() => setConfirm(null)} className="btn-ghost">Cancel</button>
                  </div>
                ) : (
                  help.actions.map((ac) => {
                    const n = (sel.size ? selected : actionable(ac)).filter((g) => can(g, ac)).length
                    const rec = ac === help.recommend
                    if (n === 0 && key === 'pending-owner') return null
                    return (
                      <button key={ac} onClick={() => setConfirm(ac)} disabled={n === 0}
                        className={btnTone(ac, rec)} title={ACTIONS[ac].help}>
                        {ACTIONS[ac].label}{sel.size ? '' : ' all'} <span className="num opacity-70">({fmt(n)})</span>
                      </button>
                    )
                  })
                )}
                {!busy && !confirm && sel.size > 0 && (
                  <button onClick={() => { ignore(selected.map((g) => ({ key: ignoreKey.pair(g.sourceId, g.personKey), kind: 'pair', label: `${personByKey.get(g.personKey)?.name || 'someone'} on ${g.name}` }))); setSel(new Set()) }}
                    className="btn-ghost" title="Mark as intentionally shared: hidden from leaks and the score, kept in this browser">🙈 Ignore selected</button>
                )}
              </div>
            )}

            {issue.items.length > 0 && (
              <div className="px-5 py-3 flex flex-col sm:flex-row gap-2 border-b border-line">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files and folders…" className="input flex-1" />
                <div className="flex gap-1 bg-surface2 rounded-lg p-1 shrink-0">
                  <button onClick={() => setGrouped(true)} className={grouped ? 'chip-on' : 'chip-off'}>By folder <span className="num opacity-70">({fmt(groupedCount)})</span></button>
                  <button onClick={() => setGrouped(false)} className={!grouped ? 'chip-on' : 'chip-off'}>Every item <span className="num opacity-70">({fmt(issue.items.length)})</span></button>
                </div>
                {grouped && expandableKeys.length > 0 && (
                  <button onClick={() => setOpen(allOpen ? new Set() : new Set(expandableKeys))} className="btn-outline shrink-0" title="Show or hide the files and people inside every folder">
                    <Chevron open={allOpen} size={14} /> {allOpen ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
              </div>
            )}

            <div className="divide-y divide-line">
              {issue.items.length === 0 && <Empty icon="✓" title="Nothing here" sub="This kind of leak is clear." />}
              {issue.items.length > 0 && rows.length === 0 && <Empty icon="🔍" title="Nothing matches" />}
              {paged.rows.map((r) => {
                const expanded = open.has(r.key)
                const people = r.groups.map((g) => ({ g, person: personByKey.get(g.personKey) }))
                const single = people.length === 1
                const g0 = r.groups[0]
                const rowKeys = r.groups.filter(pickable).map((g) => g.key)
                const checked = rowKeys.length > 0 && rowKeys.every((k) => sel.has(k))
                const expandable = r.folderRow || !single
                const age = r.items.reduce((m, i) => (i.ageDays != null && (m == null || i.ageDays < m) ? i.ageDays : m), null)
                const sub = expandable
                  ? [r.folderRow ? `${fmt(r.items.length)} ${r.items.length === 1 ? 'item' : 'items'} inside` : null, !single ? `${fmt(people.length)} people` : null].filter(Boolean).join(' · ')
                  : r.via ? `via 📁 ${r.via}` : undefined
                const rf = a.byId.get(r.sourceId)
                return (
                  <div key={r.key} className={checked ? 'bg-brand-soft/40' : ''}>
                    <div className="flex items-center gap-3 px-5 py-3">
                      {help.actions.length > 0 && (
                        rowKeys.length
                          ? <Checkbox checked={checked} indeterminate={!checked && rowKeys.some((k) => sel.has(k))} onChange={(on) => toggleKeys(rowKeys, on)} />
                          : <span className="w-4" title="You can't change this one" />
                      )}
                      {expandable
                        ? <button onClick={() => toggleOpen(r.key)} className="w-7 h-7 grid place-items-center rounded-lg text-ink2 hover:bg-surface2 hover:text-ink" title={expanded ? 'Collapse' : 'Show what is inside'}><Chevron open={expanded} /></button>
                        : <span className="w-7" />}
                      <div className="flex-1 min-w-0">
                        <button onClick={() => openFile(r.sourceId)} className="block w-full text-left" title="Open sharing settings">
                          <FileCell name={r.name} mimeType={r.mimeType} sensitive={!r.folderRow && r.items[0]?.sensitive} sub={expandable ? false : sub} {...folderProps(a, rf, openFolder)} />
                        </button>
                        {expandable && (
                          <button onClick={() => toggleOpen(r.key)} className="ml-7 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                            <Chevron open={expanded} size={12} /> {expanded ? 'Hide' : 'Show'} {sub}
                          </button>
                        )}
                      </div>
                      {single ? <PersonChip person={people[0].person} onOpen={openPerson} /> : (
                        <button onClick={() => toggleOpen(r.key)} className="flex -space-x-2 shrink-0" title={people.map((p) => p.person?.name).filter(Boolean).join(', ')}>
                          {people.slice(0, 4).map(({ g, person }) => (
                            <div key={g.key} className="ring-2 ring-surface rounded-full"><Avatar name={person?.name} photo={person?.photo} kind={person?.kind} size={24} /></div>
                          ))}
                          {people.length > 4 && <div className="ring-2 ring-surface rounded-full bg-surface2 text-ink2 text-[10px] font-bold grid place-items-center w-6 h-6">+{people.length - 4}</div>}
                        </button>
                      )}
                      {age != null && <span className="num text-xs text-ink3 w-10 text-right hidden sm:block" title="last activity">{ageLabel(age)}</span>}
                      {single && <RoleBadge role={g0.role} />}
                      {single && g0.perm?.allowFileDiscovery && <Tag color="red" title="Search engines can find this">web</Tag>}
                      {single && g0.perm?.expirationTime && <Tag color="slate" title={new Date(g0.perm.expirationTime).toLocaleDateString()}>⏳</Tag>}
                      <RowActions groups={r.groups} actions={help.actions} busy={busy} onRun={run} />
                      <button onClick={() => ignore({ key: ignoreKey.file(r.sourceId), kind: 'file', label: r.name })} disabled={!!busy}
                        className="text-ink3 hover:text-ink hover:bg-surface2 px-2 py-1 rounded-lg text-xs font-semibold" title={r.folderRow ? 'Intentionally shared: hide this folder and everything inside from leaks and the score' : 'Intentionally shared: hide this file from leaks and the score'}>Ignore</button>
                    </div>
                    {expanded && (
                      <div className="pl-14 pr-5 pb-3 space-y-2">
                        {!single && (
                          <div className="rounded-xl ring-1 ring-line divide-y divide-line">
                            {people.map(({ g, person }) => (
                              <div key={g.key} className={`flex items-center gap-3 px-3 py-2 ${sel.has(g.key) ? 'bg-brand-soft/40' : ''}`}>
                                {help.actions.length > 0 && (pickable(g) ? <Checkbox checked={sel.has(g.key)} onChange={(on) => toggleKeys([g.key], on)} /> : <span className="w-4" />)}
                                <PersonChip person={person} onOpen={openPerson} />
                                <div className="flex-1" />
                                <RoleBadge role={g.role} />
                                {g.perm?.allowFileDiscovery && <Tag color="red">web</Tag>}
                                {g.perm?.expirationTime && <Tag color="slate">⏳</Tag>}
                                <RowActions groups={[g]} actions={help.actions} busy={busy} onRun={run} />
                                <button onClick={() => ignore({ key: ignoreKey.pair(r.sourceId, g.personKey), kind: 'pair', label: `${person?.name || 'someone'} on ${r.name}` })} disabled={!!busy}
                                  className="text-ink3 hover:text-ink hover:bg-surface2 px-2 py-1 rounded-lg text-xs font-semibold" title="Intentionally shared with this person: hide from leaks and the score">Ignore</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {r.folderRow && (
                          <div className="max-h-72 overflow-y-auto">
                            {r.items.slice(0, 300).map((it) => (
                              <button key={it.fileId} onClick={() => openFile(it.fileId)} className="w-full flex items-center gap-3 py-1.5 text-left hover:bg-surface2 rounded-lg px-2">
                                <div className="flex-1 min-w-0"><FileCell name={it.name} mimeType={it.mimeType} sensitive={it.sensitive} /></div>
                                <span className="num text-xs text-ink3">{ageLabel(it.ageDays)}</span>
                              </button>
                            ))}
                            {r.items.length > 300 && <div className="text-xs text-ink3 px-2 py-1">…and {fmt(r.items.length - 300)} more</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <Pager paged={paged} className="px-5 py-3 border-t border-line" />
          </div>
        )}
      </section>
    </div>
  )
}

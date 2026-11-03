import React, { useMemo, useState } from 'react'
import { buildFolderMap, LEVELS, LEVEL_INFO } from '../lib/analyze.js'
import { Treemap, Legend } from './charts.jsx'
import { FileCell, LevelDot, LevelTag, Tag, Pager, usePaged, Empty, fmt } from './ui.jsx'

const METRICS = [['exposed', 'Shared items'], ['risk', 'Risk'], ['count', 'All items']]
const colorOf = (n) => (n.id === '__root__' ? 'var(--c-stale)' : LEVEL_INFO[LEVELS[n.maxLvl]].color)

// Where the leaks live: a treemap of folders, sized by how much is shared inside
// and coloured by the widest audience anything inside reaches. Click to drill.
export default function MapView({ a, openFile, goInside }) {
  const map = useMemo(() => buildFolderMap(a.files, a.byId), [a])
  const [path, setPath] = useState([])
  const [metric, setMetric] = useState('exposed')
  const current = path.length ? map.nodes.get(path[path.length - 1]) : null

  const kids = useMemo(() => {
    const list = current ? current.children.map((id) => map.nodes.get(id)) : [...map.roots, ...(map.loose.count ? [map.loose] : [])]
    return list.map((n) => ({ ...n, key: n.id, value: n[metric] })).filter((n) => n.value > 0).sort((x, y) => y.value - x.value).slice(0, 80)
  }, [current, map, metric])

  const hotspots = useMemo(() => [...map.nodes.values()].filter((n) => n.exposed > 0).sort((x, y) => y.risk - x.risk || y.exposed - x.exposed).slice(0, 8), [map])

  // Everything shared inside the current folder, deepest levels included.
  const inside = useMemo(() => {
    if (!current) return []
    const set = new Set([current.id])
    const stack = [...current.children]
    while (stack.length) { const id = stack.pop(); if (!set.has(id)) { set.add(id); stack.push(...(map.nodes.get(id)?.children || [])) } }
    return a.files.filter((f) => f._others && set.has(f.parents?.[0])).sort((x, y) => y._risk - x._risk || y._others - x._others)
  }, [current, map, a.files])
  const paged = usePaged(inside, 50)

  const chainTo = (id) => { const out = []; let cur = id; for (let i = 0; cur && i < 64; i++) { out.unshift(cur); cur = map.nodes.get(cur)?.parentId } return out }
  const select = (n) => {
    if (n.id === '__root__') return goInside('__root__')
    if (n.children.length) setPath(chainTo(n.id))
    else goInside(n.id)
  }
  const self = current && a.byId.get(current.id)
  const legend = LEVELS.slice().reverse().map((l) => ({ key: l, label: LEVEL_INFO[l].short, color: LEVEL_INFO[l].color }))

  return (
    <div className="grid lg:grid-cols-[1fr,340px] gap-4 items-start">
      <div className="card p-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <nav className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
            <button onClick={() => setPath([])} className={path.length ? 'text-ink2 hover:text-brand' : 'font-bold text-ink'}>All folders</button>
            {path.map((id, i) => (
              <React.Fragment key={id}>
                <span className="text-ink3">›</span>
                <button onClick={() => setPath(path.slice(0, i + 1))} className={i === path.length - 1 ? 'font-bold text-ink' : 'text-ink2 hover:text-brand'}>{map.nodes.get(id)?.name}</button>
              </React.Fragment>
            ))}
          </nav>
          <div className="flex gap-1 bg-surface2 rounded-lg p-1 ml-auto">
            {METRICS.map(([k, l]) => <button key={k} onClick={() => setMetric(k)} className={metric === k ? 'chip-on' : 'chip-off'}>{l}</button>)}
          </div>
        </div>
        {kids.length === 0 ? (
          <Empty icon="🔒" title={current ? 'Nothing shared in the folders here' : 'No folders to map'} sub={current && current.loose ? `${fmt(current.loose)} files sit directly in this folder.` : 'Switch the size to "All items" to see every folder.'} />
        ) : (
          <Treemap nodes={kids} height={440} onSelect={select} colorOf={colorOf}
            subOf={(n) => `${fmt(n.exposed)} shared · ${fmt(n.count)} items`} />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Legend items={legend} />
          <span className="text-xs text-ink3 ml-auto">colour = widest audience inside · click a folder to drill in</span>
        </div>
      </div>

      <aside className="space-y-4">
        {current ? (
          <div className="card p-4">
            <div className="font-bold text-ink truncate">📁 {current.name}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <LevelTag level={LEVELS[current.maxLvl]} />
              {self?._others > 0 && <Tag color="amber">shared with {fmt(self._others)} directly</Tag>}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div><div className="num text-lg font-extrabold text-ink">{fmt(current.count)}</div><div className="text-[11px] text-ink3">items inside</div></div>
              <div><div className={`num text-lg font-extrabold ${current.exposed ? 'text-warn' : 'text-ink'}`}>{fmt(current.exposed)}</div><div className="text-[11px] text-ink3">shared</div></div>
              <div><div className="num text-lg font-extrabold text-ink">{fmt(current.loose)}</div><div className="text-[11px] text-ink3">files directly here</div></div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {self && <button onClick={() => openFile(current.id)} className="btn-primary">Folder sharing →</button>}
              <button onClick={() => goInside(current.id)} className="btn-outline">List files here</button>
            </div>
          </div>
        ) : (
          <div className="card p-4">
            <div className="font-bold text-ink">Hotspots</div>
            <div className="text-xs text-ink3 mb-2">folders carrying the most risk, anywhere in the tree</div>
            {hotspots.length === 0 && <div className="text-sm text-ink3 py-4 text-center">Nothing shared inside any folder.</div>}
            <ul className="divide-y divide-line">
              {hotspots.map((n) => (
                <li key={n.id}>
                  <button onClick={() => setPath(chainTo(n.id))} className="w-full flex items-center gap-2 py-2 text-left hover:bg-surface2 rounded-lg px-1">
                    <LevelDot level={LEVELS[n.maxLvl]} />
                    <span className="flex-1 min-w-0 truncate text-sm text-ink">{n.name}</span>
                    <span className="num text-xs text-ink3">{fmt(n.exposed)} shared</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {current && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <div className="font-bold text-ink">Shared inside, riskiest first</div>
              <div className="text-xs text-ink3 num">{fmt(inside.length)} items at any depth</div>
            </div>
            <div className="divide-y divide-line max-h-[60vh] overflow-y-auto">
              {inside.length === 0 && <Empty icon="✓" title="Nothing shared in here" />}
              {paged.rows.map((f) => (
                <button key={f.id} onClick={() => openFile(f.id)} className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-surface2">
                  <LevelDot level={f._level} size={8} />
                  <div className="flex-1 min-w-0"><FileCell name={f.name} mimeType={f.mimeType} sensitive={f._sensitive} /></div>
                  <span className="num text-xs text-ink3">{fmt(f._others)}</span>
                </button>
              ))}
            </div>
            <Pager paged={paged} className="px-4 py-2 border-t border-line text-xs" />
          </div>
        )}
      </aside>
    </div>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'

/*
 * Self-contained inline-SVG charts for the exposure dashboard. No libraries, no
 * built-in palette: every color is passed in by the caller (usually a CSS variable
 * such as 'var(--c-public)'). Text is drawn in currentColor so it follows the page
 * ink in light and dark mode. Optional CSS variables consumed here:
 *   --surface  separator gap between marks (falls back to #fff)
 *   --line     MiniBar track (falls back to a translucent gray)
 * Every chart carries <title> tooltips; keep a table twin in the page for a11y.
 */

// ---------------------------------------------------------------- helpers
const fmt = (n) => (Number.isFinite(+n) ? +n : 0).toLocaleString()
const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0) // negative/NaN → 0
const r2 = (n) => Math.round(n * 100) / 100 // short path strings
const div = (a, b) => (b > 0 ? a / b : 0) // never NaN/Infinity
const SURFACE = 'var(--surface, #fff)'
const MUTED = 0.6 // secondary text opacity
const TEXT = { fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }
// Text on top of a saturated fill: white with a soft dark halo so it reads on any hue.
const INK_ON_FILL = { ...TEXT, fill: '#fff', paintOrder: 'stroke', stroke: 'rgba(0,0,0,.35)', strokeWidth: 3, strokeLinejoin: 'round' }

// SVG text has no ellipsis; budget ~perChar px per character and cut with "…".
function clip(s, px, perChar = 6.4) {
  const str = String(s ?? '')
  const n = Math.max(1, Math.floor(px / perChar))
  return str.length > n ? str.slice(0, Math.max(1, n - 1)) + '…' : str
}

// Props that turn an SVG element into a button (click + Enter/Space + a11y name).
function pressable(onSelect, arg, label) {
  if (!onSelect) return {}
  const go = () => onSelect(arg)
  return {
    role: 'button', tabIndex: 0, 'aria-label': label, onClick: go,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } },
  }
}
const hoverable = (set, key) => ({ onMouseEnter: () => set(key), onMouseLeave: () => set(null), onFocus: () => set(key), onBlur: () => set(null) })
const dimIf = (selected, key) => (selected != null && key !== selected ? 0.45 : 1)

// Measure the container so text stays at its true pixel size instead of scaling with the viewBox.
function useWidth(fallback) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => { const cw = entries[0] && entries[0].contentRect.width; if (cw > 0) setW(cw) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [w, ref]
}

// Angles are degrees clockwise from 12 o'clock.
const polar = (cx, cy, r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))] }

// Annular sector between radii r0 (inner) and r1 (outer) from angle a0 to a1.
function arcPath(cx, cy, r0, r1, a0, a1) {
  const sweep = a1 - a0
  if (sweep >= 359.99) { // a full ring: one arc can't end where it starts, so draw two halves per edge
    const [ox, oy] = polar(cx, cy, r1, 0), [ox2, oy2] = polar(cx, cy, r1, 180)
    const [ix, iy] = polar(cx, cy, r0, 0), [ix2, iy2] = polar(cx, cy, r0, 180)
    return `M${ox} ${oy}A${r1} ${r1} 0 1 1 ${ox2} ${oy2}A${r1} ${r1} 0 1 1 ${ox} ${oy}M${ix} ${iy}A${r0} ${r0} 0 1 0 ${ix2} ${iy2}A${r0} ${r0} 0 1 0 ${ix} ${iy}Z`
  }
  const large = sweep > 180 ? 1 : 0
  const [sx, sy] = polar(cx, cy, r1, a0), [ex, ey] = polar(cx, cy, r1, a1)
  const [isx, isy] = polar(cx, cy, r0, a1), [iex, iey] = polar(cx, cy, r0, a0)
  return `M${sx} ${sy}A${r1} ${r1} 0 ${large} 1 ${ex} ${ey}L${isx} ${isy}A${r0} ${r0} 0 ${large} 0 ${iex} ${iey}Z`
}

// A bar with a 4px-rounded data end and a square baseline end.
// dir 'right': grows from x to the right. dir 'up': y is the top, baseline at y+h.
function barPath(x, y, w, h, dir) {
  const r = r2(Math.max(0, Math.min(4, w / 2, h / 2)))
  if (dir === 'right') return `M${r2(x)} ${r2(y)}H${r2(x + w - r)}a${r} ${r} 0 0 1 ${r} ${r}V${r2(y + h - r)}a${r} ${r} 0 0 1 -${r} ${r}H${r2(x)}Z`
  return `M${r2(x)} ${r2(y + h)}V${r2(y + r)}a${r} ${r} 0 0 1 ${r} -${r}H${r2(x + w - r)}a${r} ${r} 0 0 1 ${r} ${r}V${r2(y + h)}Z`
}

function Empty({ height = 64, className }) {
  return (
    <svg className={className} width="100%" height={height} role="img" aria-label="No data" style={TEXT}>
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize={12} fill="currentColor" opacity={0.5}>No data</text>
    </svg>
  )
}

// ---------------------------------------------------------------- ScoreDial
export function ScoreDial({ value, size = 160, color = 'currentColor', label = 'score', grade, className }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(+value) ? +value : 0))
  const [shown, setShown] = useState(0) // start empty so the first paint animates up to `value`
  useEffect(() => { const id = requestAnimationFrame(() => setShown(v)); return () => cancelAnimationFrame(id) }, [v])
  const sw = Math.max(8, Math.round(size * 0.075))
  const c = size / 2, r = c - sw / 2 - 2
  // 270° arc open at the bottom: from 7:30 (-135°) clockwise over the top to 4:30 (+135°).
  const [sx, sy] = polar(c, c, r, -135), [ex, ey] = polar(c, c, r, 135)
  const d = `M${sx} ${sy}A${r} ${r} 0 1 1 ${ex} ${ey}`
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, height: 'auto', display: 'block', fontFamily: 'inherit' }}
      role="img" aria-label={`${label} ${Math.round(v)} out of 100${grade ? `, grade ${grade}` : ''}`}>
      <path d={d} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={sw} strokeLinecap="round" />
      {/* pathLength normalises the arc to 100 units, so the dash offset is simply 100 − value. */}
      <path d={d} pathLength={100} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray="100 100" strokeDashoffset={100 - shown}
        style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.4,0,.2,1), opacity .3s', opacity: shown > 0 ? 1 : 0 }} />
      <text x={c} y={c + size * 0.06} textAnchor="middle" fontSize={size * 0.24} fontWeight={600} fill="currentColor">{Math.round(v)}</text>
      <text x={c} y={c + size * 0.19} textAnchor="middle" fontSize={12} fill="currentColor" opacity={MUTED}>{label}</text>
      {grade && (
        <g transform={`translate(${c} ${c + r - 6})`}>
          <rect x={-11} y={-9} width={22} height={18} rx={9} fill={color} fillOpacity={0.18} stroke={color} strokeOpacity={0.5} />
          <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill="currentColor">{grade}</text>
        </g>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- Donut
export function Donut({ segments = [], size = 180, thickness = 22, center, sub, onSelect, selected, legend = true, className }) {
  const [active, setActive] = useState(null)
  const segs = segments.map((s) => ({ ...s, v: num(s.value) })).filter((s) => s.v > 0)
  const total = segs.reduce((t, s) => t + s.v, 0)
  if (!segs.length) return <Empty className={className} height={size} />
  const c = size / 2, r1 = c - 4, r0 = Math.max(4, r1 - thickness)
  let a0 = 0
  const arcs = segs.map((s, i) => {
    const a1 = a0 + (s.v / total) * 360, d = arcPath(c, c, r0, r1, a0, a1)
    a0 = a1
    return { ...s, d, pct: Math.round((s.v / total) * 100), k: s.key ?? i }
  })
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ ...TEXT, maxWidth: size, height: 'auto', display: 'block' }}
        role={onSelect ? 'group' : 'img'} aria-label={`Donut: ${arcs.map((s) => `${s.label} ${s.pct}%`).join(', ')}`}>
        {arcs.map((s) => (
          <path key={s.k} d={s.d} fill={s.color} fillRule="evenodd" stroke={SURFACE} strokeWidth={2} opacity={dimIf(selected, s.k)}
            style={{ transformOrigin: `${c}px ${c}px`, transform: active === s.k ? 'scale(1.04)' : 'scale(1)', transition: 'transform .15s, opacity .15s', cursor: onSelect ? 'pointer' : 'default' }}
            {...hoverable(setActive, s.k)} {...pressable(onSelect, s.k, `${s.label}, ${fmt(s.v)}, ${s.pct}%`)}>
            <title>{`${s.label} · ${fmt(s.v)} · ${s.pct}%`}</title>
          </path>
        ))}
        {center != null && <text x={c} y={c + (sub != null ? 0 : size * 0.04)} textAnchor="middle" dy={sub != null ? '0.1em' : '0.35em'} fontSize={size * 0.15} fontWeight={600} fill="currentColor" pointerEvents="none" style={{ fontVariantNumeric: 'normal' }}>{center}</text>}
        {sub != null && <text x={c} y={c + size * 0.11} textAnchor="middle" fontSize={11} fill="currentColor" opacity={MUTED} pointerEvents="none">{sub}</text>}
      </svg>
      {legend && <Legend items={arcs.map((s) => ({ key: s.k, label: s.label, color: s.color, value: s.v }))} onSelect={onSelect} selected={selected} style={{ marginTop: 10 }} />}
    </div>
  )
}

// ---------------------------------------------------------------- Bars (horizontal)
export function Bars({ rows = [], format = fmt, onSelect, selected, maxRows = 8, height, className }) {
  const [w, ref] = useWidth(360)
  const [active, setActive] = useState(null)
  const list = rows.slice(0, maxRows).map((r, i) => ({ ...r, v: num(r.value), k: r.key ?? i }))
  const max = Math.max(0, ...list.map((r) => r.v))
  if (!list.length || max <= 0) return <Empty className={className} height={height || 64} />
  const H = height || list.length * 28, rh = H / list.length
  const labelW = Math.round(Math.min(150, w * 0.34))
  const valueW = Math.max(...list.map((r) => String(format(r.v)).length)) * 7 + 6
  const x0 = labelW + 10, barW = Math.max(0, w - x0 - valueW - 10)
  return (
    <div ref={ref} className={className}>
      <svg width="100%" height={H} viewBox={`0 0 ${w} ${H}`} style={TEXT} role={onSelect ? 'group' : 'img'} aria-label={`Bar chart, ${list.length} rows`}>
        <line x1={x0 - 0.5} x2={x0 - 0.5} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.15} />
        {list.map((r, i) => {
          const y = i * rh, cy = y + rh / 2, bw = r.v > 0 ? Math.max(2, (r.v / max) * barW) : 0, txt = format(r.v)
          return (
            <g key={r.k} opacity={dimIf(selected, r.k)} style={{ cursor: onSelect ? 'pointer' : 'default' }}
              {...hoverable(setActive, r.k)} {...pressable(onSelect, r.k, `${r.label}, ${txt}`)}>
              <title>{`${r.label}${r.sub ? ' · ' + r.sub : ''} · ${txt}`}</title>
              <rect x={0} y={y} width={w} height={rh} rx={4} fill="currentColor" opacity={active === r.k ? 0.06 : 0} />
              <text x={0} y={r.sub ? cy - 4 : cy} dy="0.35em" fontSize={12} fill="currentColor">{clip(r.label, labelW)}</text>
              {r.sub && <text x={0} y={cy + 8} dy="0.35em" fontSize={10} fill="currentColor" opacity={MUTED}>{clip(r.sub, labelW, 5.5)}</text>}
              {bw > 0 && <path d={barPath(x0, cy - 7, bw, 14, 'right')} fill={r.color} />}
              <text x={w} y={cy} dy="0.35em" textAnchor="end" fontSize={12} fill="currentColor">{txt}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------- Columns (histogram)
export function Columns({ buckets = [], format = fmt, onSelect, selected, height = 140, className }) {
  const [w, ref] = useWidth(360)
  const [active, setActive] = useState(null)
  const list = buckets.map((b, i) => ({ ...b, v: num(b.value), k: b.key ?? i }))
  const max = Math.max(0, ...list.map((b) => b.v))
  if (!list.length || max <= 0) return <Empty className={className} height={height} />
  const top = 18, bottom = 20, plotH = Math.max(10, height - top - bottom), base = top + plotH
  const slot = w / list.length, colW = Math.max(2, Math.min(24, slot - 2))
  return (
    <div ref={ref} className={className}>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} style={TEXT} role={onSelect ? 'group' : 'img'} aria-label={`Column chart, ${list.length} buckets`}>
        {[0.5, 1].map((f) => <line key={f} x1={0} x2={w} y1={r2(base - plotH * f)} y2={r2(base - plotH * f)} stroke="currentColor" strokeOpacity={0.08} />)}
        <line x1={0} x2={w} y1={base + 0.5} y2={base + 0.5} stroke="currentColor" strokeOpacity={0.3} />
        {list.map((b, i) => {
          const h = b.v > 0 ? Math.max(2, (b.v / max) * plotH) : 0, x = i * slot + (slot - colW) / 2, cx = i * slot + slot / 2
          const txt = String(format(b.v)), showVal = b.v > 0 && slot >= txt.length * 6.2 + 4
          return (
            <g key={b.k} opacity={dimIf(selected, b.k)} style={{ cursor: onSelect ? 'pointer' : 'default' }}
              {...hoverable(setActive, b.k)} {...pressable(onSelect, b.k, `${b.label}, ${txt}`)}>
              <title>{`${b.label} · ${txt}`}</title>
              <rect x={r2(i * slot)} y={0} width={r2(slot)} height={height} rx={4} fill="currentColor" opacity={active === b.k ? 0.06 : 0} />
              {h > 0 && <path d={barPath(x, base - h, colW, h, 'up')} fill={b.color} />}
              {showVal && <text x={cx} y={base - h - 5} textAnchor="middle" fontSize={11} fill="currentColor">{txt}</text>}
              <text x={cx} y={base + 14} textAnchor="middle" fontSize={11} fill="currentColor" opacity={MUTED}>{clip(b.label, slot - 4, 6)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------- Treemap
/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk 2000). Items are sorted by
 * value desc and laid in rows along the shorter side of the remaining rectangle; an
 * item joins the current row only while it does not worsen the row's worst aspect
 * ratio, otherwise the row is flushed and a new one starts.
 * Returns [{ ...item, x, y, w, h }]; zero/negative values and empty input give [].
 */
export function squarify(items, x, y, w, h) {
  const list = (items || []).map((it) => ({ ...it, value: num(it && it.value) })).filter((it) => it.value > 0).sort((a, b) => b.value - a.value)
  const total = list.reduce((t, it) => t + it.value, 0)
  if (!list.length || !(w > 0) || !(h > 0)) return []
  const scale = (w * h) / total // px² per unit of value
  const out = []
  let rx = x, ry = y, rw = w, rh = h // the free rectangle still to fill
  let row = [], rowArea = 0
  // Worst aspect ratio in a row of total `area` laid along a side of length `side`:
  // each item is a (side·a/area) × (area/side) box, so its ratio is max(side²a/area², area²/(side²a)).
  const worst = (areas, area, side) => {
    const s2 = side * side, a2 = area * area
    return Math.max(...areas.map((a) => Math.max((s2 * a) / a2, a2 / (s2 * a))))
  }
  const flush = () => {
    if (rw >= rh) { // free rect is wide → stack the row as a vertical strip on the left
      const sw = Math.min(rw, div(rowArea, rh))
      let cy = ry
      for (const it of row) { const ih = div(it.area, sw); out.push({ ...it.item, x: rx, y: cy, w: sw, h: ih }); cy += ih }
      rx += sw; rw -= sw
    } else { // free rect is tall → lay the row as a horizontal strip on top
      const sh = Math.min(rh, div(rowArea, rw))
      let cx = rx
      for (const it of row) { const iw = div(it.area, sh); out.push({ ...it.item, x: cx, y: ry, w: iw, h: sh }); cx += iw }
      ry += sh; rh -= sh
    }
    row = []; rowArea = 0
  }
  for (const item of list) {
    const area = item.value * scale, side = Math.min(rw, rh), areas = row.map((r) => r.area)
    if (row.length && worst(areas, rowArea, side) < worst([...areas, area], rowArea + area, side)) flush()
    row.push({ item, area }); rowArea += area
  }
  if (row.length) flush()
  return out
}

export function Treemap({ nodes = [], width = 800, height = 360, onSelect, colorOf = () => 'currentColor', labelOf = (n) => n.name, subOf = (n) => fmt(n.value), padding = 2, className }) {
  const [w, ref] = useWidth(width)
  const [active, setActive] = useState(null)
  const rects = useMemo(() => squarify(nodes, 0, 0, w, height), [nodes, w, height])
  if (!rects.length) return <Empty className={className} height={Math.min(height, 120)} />
  const p = padding / 2
  return (
    <div ref={ref} className={className}>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} style={TEXT} role={onSelect ? 'group' : 'img'} aria-label={`Treemap, ${rects.length} items`}>
        {rects.map((n, i) => {
          const rw = Math.max(0, n.w - padding), rh = Math.max(0, n.h - padding), k = n.key ?? i
          const label = String(labelOf(n) ?? ''), sub = String(subOf(n) ?? '')
          const showLabel = rw >= 60 && rh >= 28, showSub = rw >= 80 && rh >= 44
          return (
            <g key={k} transform={`translate(${r2(n.x + p)} ${r2(n.y + p)})`} style={{ cursor: onSelect ? 'pointer' : 'default' }}
              {...hoverable(setActive, k)} {...pressable(onSelect, n, `${label}, ${fmt(n.value)}`)}>
              <title>{`${label} · ${fmt(n.value)}`}</title>
              <rect width={r2(rw)} height={r2(rh)} rx={4} fill={colorOf(n)} stroke={SURFACE} strokeWidth={1}
                style={{ filter: active === k ? 'brightness(1.1)' : 'none', transition: 'filter .15s' }} />
              {showLabel && <text x={8} y={18} fontSize={12} fontWeight={600} style={INK_ON_FILL} pointerEvents="none">{clip(label, rw - 16, 6.8)}</text>}
              {showSub && <text x={8} y={34} fontSize={11} style={INK_ON_FILL} opacity={0.85} pointerEvents="none">{clip(sub, rw - 16, 6.2)}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------- Sparkline
export function Sparkline({ values = [], color = 'currentColor', height = 32, width = 120, className }) {
  const vs = values.map((v) => (Number.isFinite(+v) ? +v : 0))
  const pad = 4, n = vs.length, lo = Math.min(...vs), hi = Math.max(...vs)
  const pts = vs.map((v, i) => [
    r2(n > 1 ? pad + (i * (width - 2 * pad)) / (n - 1) : width / 2),
    r2(hi > lo ? pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad) : height / 2),
  ])
  const last = pts[n - 1]
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, height: 'auto', display: 'block' }} role="img"
      aria-label={n ? `Trend, latest ${fmt(vs[n - 1])}` : 'No data'}>
      {n > 1 && <polygon points={[...pts, [last[0], height - pad], [pts[0][0], height - pad]].map((p) => p.join(',')).join(' ')} fill={color} opacity={0.15} />}
      {n > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {last && <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />}
    </svg>
  )
}

// ---------------------------------------------------------------- Legend
export function Legend({ items = [], onSelect, selected, className, style }) {
  const Tag = onSelect ? 'button' : 'span'
  return (
    <div className={className} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, lineHeight: '16px', fontFamily: 'inherit', ...style }}>
      {items.map((it, i) => {
        const k = it.key ?? i
        return (
          <Tag key={k} type={onSelect ? 'button' : undefined} onClick={onSelect ? () => onSelect(k) : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: dimIf(selected, k), background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: onSelect ? 'pointer' : 'default' }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: it.color, flex: 'none' }} />
            <span>{it.label}</span>
            {it.value != null && <span style={{ opacity: MUTED, fontVariantNumeric: 'tabular-nums' }}>{typeof it.value === 'number' ? fmt(it.value) : it.value}</span>}
          </Tag>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- MiniBar
export function MiniBar({ value, max, color = 'currentColor', height = 6, className }) {
  const pct = max > 0 ? Math.min(100, (num(value) / max) * 100) : 0
  return (
    <svg className={className} width="100%" height={height} role="img" aria-label={`${fmt(value)} of ${fmt(max)}`} style={{ display: 'block' }}>
      <rect width="100%" height={height} rx={height / 2} fill="var(--line, rgba(128,128,128,.25))" />
      {pct > 0 && <rect width={`${r2(pct)}%`} height={height} rx={height / 2} fill={color} />}
    </svg>
  )
}

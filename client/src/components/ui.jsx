import React, { useEffect, useState } from 'react'
import { ROLE_LABEL, LEVEL_INFO, fileIcon, fileType } from '../lib/analyze.js'

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString())

export function ago(msOrIso) {
  const t = typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso)
  if (!t) return '—'
  const d = Math.floor((Date.now() - t) / 864e5)
  if (d < 1) return 'today'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  const y = (d / 365).toFixed(d < 730 ? 1 : 0)
  return `${y}y ago`
}
export function ageLabel(days) {
  if (days == null) return '—'
  if (days < 1) return 'today'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${(days / 365).toFixed(days < 730 ? 1 : 0)}y`
}

const AV_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-600']
export function Avatar({ name, photo, kind, size = 36 }) {
  const initials = (name || '?').split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) }
  if (kind === 'anyone') return <div className="rounded-full bg-danger-soft text-danger grid place-items-center shrink-0" style={style}>🌐</div>
  if (kind === 'domain') return <div className="rounded-full bg-violet-soft text-violet grid place-items-center shrink-0" style={style}>🏢</div>
  if (kind === 'group') return <div className="rounded-full bg-brand-soft text-brand grid place-items-center shrink-0" style={style}>👥</div>
  if (photo && /^https:\/\/[a-z0-9.-]*googleusercontent\.com\//.test(photo)) {
    return <img src={photo} alt="" referrerPolicy="no-referrer" className="rounded-full object-cover shrink-0" style={style} />
  }
  let h = 0
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <div className={`rounded-full text-white font-bold grid place-items-center shrink-0 ${AV_COLORS[h % AV_COLORS.length]}`} style={style}>
      {initials || '?'}
    </div>
  )
}

export function RoleBadge({ role }) {
  const map = {
    owner: 'bg-ink text-bg',
    organizer: 'bg-ink text-bg',
    fileOrganizer: 'bg-brand-soft text-brand',
    writer: 'bg-brand-soft text-brand',
    commenter: 'bg-ok-soft text-ok',
    reader: 'bg-surface2 text-ink2',
  }
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${map[role] || 'bg-surface2 text-ink2'}`}>
      {ROLE_LABEL[role] || role}
    </span>
  )
}

export function Tag({ children, color = 'slate', title }) {
  const map = {
    red: 'bg-danger-soft text-danger ring-danger/30',
    amber: 'bg-warn-soft text-warn ring-warn/30',
    blue: 'bg-brand-soft text-brand ring-brand/30',
    violet: 'bg-violet-soft text-violet ring-violet/30',
    green: 'bg-ok-soft text-ok ring-ok/30',
    pink: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:ring-pink-800',
    slate: 'bg-surface2 text-ink2 ring-line',
  }
  return <span title={title} className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ring-1 whitespace-nowrap ${map[color]}`}>{children}</span>
}

// Disclosure arrow: points right, turns down when open.
export function Chevron({ open, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Small colored dot for an exposure level, with the level name on hover.
export function LevelDot({ level, size = 10 }) {
  const info = LEVEL_INFO[level] || LEVEL_INFO.private
  return <span title={info.label} className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: info.color }} />
}
export function LevelTag({ level }) {
  const info = LEVEL_INFO[level] || LEVEL_INFO.private
  const color = { 'public-web': 'red', 'public-link': 'red', external: 'amber', domain: 'violet', internal: 'blue', private: 'green' }[level] || 'slate'
  return <Tag color={color}><LevelDot level={level} size={8} /> {info.short}</Tag>
}

// Name of the folder a file sits in, when that folder was part of the scan.
export const parentName = (a, f) => (f && a?.byId?.get(f.parents?.[0])?.name) || null
// Props for FileCell's folder button: only when the file actually has a parent
// (items only shared with you often have none).
export const folderProps = (a, f, openFolder) => (f?.parents?.[0] && openFolder ? { onFolder: () => openFolder(f), folder: parentName(a, f) } : {})

// Tiny "open the folder this is in" control. A span with a button role so it
// can sit inside a row that is itself a button.
export function FolderButton({ onClick, folder, className = '' }) {
  const label = folder ? `Open folder: ${folder}` : 'Open folder in Drive'
  const go = (e) => { e.preventDefault(); e.stopPropagation(); onClick?.() }
  return (
    <span role="button" tabIndex={0} title={label} aria-label={label} data-folder-btn
      onClick={go} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go(e)}
      className={`shrink-0 inline-grid place-items-center w-5 h-5 rounded text-[13px] leading-none text-ink3 hover:text-brand hover:bg-surface2 cursor-pointer ${className}`}>📁</span>
  )
}

export function FileCell({ name, mimeType, sub, sensitive, hits, onFolder, folder }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-lg leading-none shrink-0">{fileIcon(mimeType)}</span>
      <div className="min-w-0">
        <div className="truncate font-medium text-ink flex items-center gap-1.5">
          <span className="truncate">{name}</span>
          {sensitive && <span title={`Looks sensitive: ${(hits || []).join(', ')}`} className="text-[10px] font-bold px-1.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-950/50 dark:text-pink-300 shrink-0">SENSITIVE</span>}
          {onFolder && <FolderButton onClick={onFolder} folder={folder} />}
        </div>
        {sub !== false && <div className="text-xs text-ink3 truncate">{sub || fileType(mimeType)}</div>}
      </div>
    </div>
  )
}

export function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

export function Modal({ open, onClose, children, wide, xwide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-8 bg-black/50 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className={`bg-surface text-ink rounded-2xl shadow-pop ring-1 ring-line w-full ${xwide ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'} my-4 animate-rise`}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

export function Empty({ icon = '✨', title, sub }) {
  return (
    <div className="p-10 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="font-semibold text-ink">{title}</div>
      {sub && <div className="text-sm text-ink3 mt-1">{sub}</div>}
    </div>
  )
}

export function Checkbox({ checked, onChange, indeterminate, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={!!checked} ref={(el) => { if (el) el.indeterminate = !!indeterminate }}
        onChange={(e) => onChange?.(e.target.checked)}
        className="w-4 h-4 rounded accent-[rgb(var(--brand))]" />
      {label && <span className="text-sm text-ink2">{label}</span>}
    </label>
  )
}

// Paging for long lists: only one page of rows is ever rendered, so a person
// with 100k+ items stays smooth. Resets to the first page when the list changes.
export function usePaged(list, pageSize = 100) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [list])
  const pages = Math.max(1, Math.ceil(list.length / pageSize))
  const current = Math.min(page, pages - 1)
  return {
    rows: list.slice(current * pageSize, (current + 1) * pageSize),
    page: current, pages, pageSize, total: list.length, setPage,
  }
}

export function Pager({ paged, className = '' }) {
  const { page, pages, pageSize, total, setPage } = paged
  if (total <= pageSize) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className={`flex items-center justify-between gap-3 text-sm text-ink2 ${className}`}>
      <span className="num">{fmt(from)}–{fmt(to)} of <b className="text-ink">{fmt(total)}</b></span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost" onClick={() => setPage(0)} disabled={page === 0}>« First</button>
        <button className="btn-ghost" onClick={() => setPage(page - 1)} disabled={page === 0}>‹ Prev</button>
        <span className="px-2 num">Page {page + 1} of {fmt(pages)}</span>
        <button className="btn-ghost" onClick={() => setPage(page + 1)} disabled={page >= pages - 1}>Next ›</button>
      </div>
    </div>
  )
}

// Bottom-right toasts with an optional action (used for Undo).
export function Toasts({ items, onDismiss }) {
  if (!items.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)]">
      {items.map((t) => (
        <div key={t.id} className={`card px-4 py-3 flex items-center gap-3 animate-rise ${t.tone === 'danger' ? 'ring-danger/40' : t.tone === 'ok' ? 'ring-ok/40' : ''}`}>
          <div className="flex-1 min-w-0 text-sm text-ink">
            <div className="truncate">{t.text}</div>
            {t.sub && <div className="text-xs text-ink3 truncate">{t.sub}</div>}
          </div>
          {t.action && (
            <button onClick={t.action.run} disabled={t.action.busy} className="btn-outline">
              {t.action.busy ? <Spinner /> : null} {t.action.label}
            </button>
          )}
          <button onClick={() => onDismiss(t.id)} className="text-ink3 hover:text-ink text-lg leading-none">×</button>
        </div>
      ))}
    </div>
  )
}

// Collapsible section header used in drawers and the fix flow.
export function Section({ title, right, children, className = '' }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink3">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

import React from 'react'
import { KIND_LABEL } from '../lib/ignores.js'
import { Modal, Empty, fmt, ago } from './ui.jsx'

const ICON = { file: '📁', person: '👤', pair: '🔗' }

// The things the user marked as intentionally shared, with a way back.
export default function IgnoreList({ a, ignores, onUnignore, onClear, onClose }) {
  return (
    <Modal open onClose={onClose}>
      <div className="flex items-start gap-3 p-5 border-b border-line">
        <div className="flex-1">
          <h2 className="text-xl font-extrabold text-ink">🙈 Ignored</h2>
          <p className="text-sm text-ink2 mt-1">
            Things you marked as intentionally shared. They are left out of the leak lists and the score, and stay tagged in People and Files.
            Kept only in this browser, per account. Forget wipes it.
          </p>
        </div>
        <button onClick={onClose} className="text-ink3 hover:text-ink text-2xl leading-none -mt-1" aria-label="Close">×</button>
      </div>
      <div className="px-5 py-2 border-b border-line flex items-center gap-3 text-xs text-ink3">
        <span className="num">{fmt(ignores.length)} {ignores.length === 1 ? 'rule' : 'rules'} · {fmt(a.totals.ignored)} shares hidden in this pool</span>
        <div className="flex-1" />
        {ignores.length > 0 && <button onClick={onClear} className="btn-ghost text-xs">Clear all</button>}
      </div>
      <div className="divide-y divide-line max-h-[60vh] overflow-y-auto">
        {ignores.length === 0 && <Empty icon="🙈" title="Nothing ignored yet" sub="Use “Ignore” on a row in Fix leaks, or in a person or file drawer." />}
        {ignores.slice().sort((x, y) => (y.at || 0) - (x.at || 0)).map((e) => (
          <div key={e.key} className="flex items-center gap-3 px-5 py-2.5">
            <span className="text-lg">{ICON[e.kind] || '🙈'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink truncate">{e.label}</div>
              <div className="text-xs text-ink3">{KIND_LABEL[e.kind] || e.kind}{e.at ? ` · added ${ago(e.at)}` : ''}</div>
            </div>
            <button onClick={() => onUnignore(e.key)} className="btn-outline text-xs">Un-ignore</button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

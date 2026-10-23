import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@shared/types'
import { api } from '../util'

export function LogDrawer() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.getLog().then(setEntries)
    return api.onLog((e) => setEntries((prev) => (prev.length > 2000 ? [...prev.slice(-1500), e] : [...prev, e])))
  }, [])

  useEffect(() => {
    const el = bodyRef.current
    if (open && el) el.scrollTop = el.scrollHeight
  }, [entries, open])

  const text = (): string =>
    entries
      .map((e) => `[${new Date(e.time).toLocaleTimeString()}] ${e.kind === 'cmd' ? '$ ' : ''}${e.text}`)
      .join('\n')

  return (
    <section className="log-drawer">
      <header>
        <button className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} Details
        </button>
        <span className="muted small">raw adb commands and output</span>
        <span className="spacer" />
        {open && (
          <>
            <button className="btn small" onClick={() => navigator.clipboard.writeText(text())}>
              Copy
            </button>
            <button
              className="btn small"
              onClick={async () => {
                await api.clearLog()
                setEntries([])
              }}
            >
              Clear
            </button>
          </>
        )}
      </header>
      {open && (
        <div className="log-body mono" ref={bodyRef}>
          {entries.length === 0 && <span className="muted">Nothing yet.</span>}
          {entries.map((e) => (
            <div key={e.id} className={`log-line ${e.kind}`}>
              {e.kind === 'cmd' ? '$ ' : ''}
              {e.text}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

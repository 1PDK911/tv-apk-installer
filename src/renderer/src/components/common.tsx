import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { JobProgress, TvView } from '@shared/types'
import { describeState } from '@shared/status'
import { api } from '../util'

export function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        style={wide ? { width: 'min(760px, 100%)' } : undefined}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function StatusChip({ tv }: { tv: TvView }) {
  const s = describeState(tv.state, tv.method)
  return <span className={`chip ${s.tone}`}>{s.label}</span>
}

export function ProgressBar({ fraction }: { fraction?: number }) {
  const determinate = fraction !== undefined
  return (
    <div
      className={`progress ${determinate ? '' : 'indeterminate'}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(fraction * 100) : undefined}
    >
      <div style={determinate ? { width: `${Math.round(fraction * 100)}%` } : undefined} />
    </div>
  )
}

/** Latest progress event for a job id. */
export function useJobProgress(jobId: string | undefined): JobProgress | undefined {
  const [p, setP] = useState<JobProgress>()
  useEffect(() => {
    setP(undefined)
    if (!jobId) return
    return api.onProgress((ev) => {
      if (ev.jobId === jobId) setP(ev)
    })
  }, [jobId])
  return p
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        void api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstallOptions, InstallResult, Inspection, QueuedFile, TvView } from '@shared/types'
import { api, errorText, newJobId } from '../util'
import { Notice } from './common'
import { QueueItem } from './QueueItem'

export type ItemStatus = 'inspecting' | 'ready' | 'invalid' | 'installing' | 'installed' | 'failed' | 'cancelled'

export interface Item {
  file: QueuedFile
  status: ItemStatus
  inspection?: Inspection
  result?: InstallResult
  jobId?: string
  /** Pre-flight warnings the user chose to override. */
  overridden: boolean
}

export function InstallView({ tv }: { tv?: TvView }) {
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [runningAll, setRunningAll] = useState(false)
  const stopAll = useRef(false)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const patch = useCallback((id: string, p: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.file.id === id ? { ...it, ...p } : it)))
  }, [])

  const inspect = useCallback(
    async (file: QueuedFile, tvId: string | null) => {
      const jobId = newJobId()
      patch(file.id, { status: 'inspecting', jobId })
      try {
        const inspection = await api.inspect(jobId, file.id, tvId)
        patch(file.id, { inspection, status: inspection.info ? 'ready' : 'invalid', jobId: undefined })
      } catch (e) {
        patch(file.id, { inspection: { checks: [], error: errorText(e) }, status: 'invalid', jobId: undefined })
      }
    },
    [patch]
  )

  const addResult = (r: { added: QueuedFile[]; rejected: string[] }): void => {
    setNotice(r.rejected.length ? `Skipped: ${r.rejected.join('; ')}` : undefined)
    if (!r.added.length) return
    setItems((prev) => [...prev, ...r.added.map((file) => ({ file, status: 'inspecting' as const, overridden: false }))])
    for (const f of r.added) void inspect(f, tv?.state === 'connected' ? tv.id : null)
  }

  // Re-run pre-flight checks when the TV changes or finishes connecting.
  const tvKey = tv?.state === 'connected' ? `${tv.id}:${tv.info?.freeBytes ?? ''}` : 'none'
  const lastTvKey = useRef(tvKey)
  useEffect(() => {
    if (lastTvKey.current === tvKey) return
    lastTvKey.current = tvKey
    for (const it of itemsRef.current)
      if (it.status === 'ready' || it.status === 'invalid') void inspect(it.file, tv?.state === 'connected' ? tv.id : null)
  }, [tvKey, tv, inspect])

  // Prevent the window from navigating to a file dropped outside the drop zone.
  useEffect(() => {
    const stop = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  const install = useCallback(
    async (id: string, options: InstallOptions = {}): Promise<boolean> => {
      if (!tv || tv.state !== 'connected') return false
      const jobId = newJobId()
      patch(id, { status: 'installing', jobId, result: undefined })
      try {
        const result = await api.install(jobId, id, tv.id, options)
        patch(id, { status: result.ok ? 'installed' : result.cancelled ? 'cancelled' : 'failed', result, jobId: undefined })
        return result.ok
      } catch (e) {
        patch(id, { status: 'failed', result: { ok: false, message: errorText(e) }, jobId: undefined })
        return false
      }
    },
    [tv, patch]
  )

  const blocked = (it: Item): boolean =>
    !!it.inspection?.checks.some((c) => c.level === 'block' || c.level === 'warn') && !it.overridden

  const installAll = async (): Promise<void> => {
    setRunningAll(true)
    stopAll.current = false
    for (const it of itemsRef.current) {
      if (stopAll.current) break
      const current = itemsRef.current.find((x) => x.file.id === it.file.id)
      if (!current || current.status !== 'ready' || blocked(current)) continue
      await install(it.file.id)
    }
    setRunningAll(false)
  }

  const remove = (id: string): void => {
    const it = items.find((x) => x.file.id === id)
    if (it?.jobId) void api.cancelJob(it.jobId)
    setItems((prev) => prev.filter((x) => x.file.id !== id))
    void api.removeFile(id)
  }

  const connected = tv?.state === 'connected'
  const readyCount = items.filter((i) => i.status === 'ready' && !blocked(i)).length

  return (
    <div className="stack">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={async () => addResult(await api.pickFiles())}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' || e.key === ' ') addResult(await api.pickFiles())
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files.length) addResult(await api.addDroppedFiles(Array.from(e.dataTransfer.files)))
        }}
      >
        <div className="big">Drop APK files here</div>
        <div className="muted">or click to choose · .apk, .apks, .xapk, .apkm</div>
      </div>
      {notice && <Notice tone="warn">{notice}</Notice>}
      {!connected && items.length > 0 && (
        <Notice tone="info">Connect to a TV to run the compatibility checks and install.</Notice>
      )}

      {items.length > 0 && (
        <div className="row">
          <h2 style={{ margin: 0, fontSize: 15 }}>Install queue</h2>
          <span className="spacer" />
          {runningAll ? (
            <button
              className="btn"
              onClick={() => {
                stopAll.current = true
                const cur = itemsRef.current.find((i) => i.status === 'installing')
                if (cur?.jobId) void api.cancelJob(cur.jobId)
              }}
            >
              Stop
            </button>
          ) : (
            <button className="btn primary" disabled={!connected || readyCount === 0} onClick={installAll}>
              Install {readyCount > 1 ? `all (${readyCount})` : ''}
            </button>
          )}
          <button
            className="btn"
            disabled={runningAll}
            onClick={() => {
              for (const it of items) if (it.status === 'installed' || it.status === 'invalid') remove(it.file.id)
            }}
          >
            Clear finished
          </button>
        </div>
      )}

      <div className="queue">
        {items.map((it) => (
          <QueueItem
            key={it.file.id}
            item={it}
            tv={tv}
            busy={runningAll}
            blocked={blocked(it)}
            onInstall={(opts) => install(it.file.id, opts)}
            onOverride={(v) => patch(it.file.id, { overridden: v })}
            onRemove={() => remove(it.file.id)}
          />
        ))}
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { TvView } from '@shared/types'
import { describeState } from '@shared/status'
import { validateHostPort, validateTvName } from '@shared/validation'
import { api, errorText, formatBytes, newJobId } from '../util'
import { Notice, ProgressBar, StatusChip } from './common'

export function TvPanel({ tv, onPairAgain }: { tv: TvView; onPairAgain: () => void }) {
  const [jobId, setJobId] = useState<string>()
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  const [hostPort, setHostPort] = useState('')
  const [hostPortErr, setHostPortErr] = useState<string>()
  const [renaming, setRenaming] = useState<string>()
  const [confirmForget, setConfirmForget] = useState(false)
  const copy = describeState(tv.state, tv.method)
  const busy = !!jobId || tv.state === 'connecting'

  const run = async (fn: (id: string) => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    const id = newJobId()
    setJobId(id)
    setMsg(undefined)
    try {
      const r = await fn(id)
      setMsg({ ok: r.ok, text: r.message })
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) })
    } finally {
      setJobId(undefined)
    }
  }

  const submitPort = (): void => {
    const v = validateHostPort(hostPort.includes(':') ? hostPort : `${tv.ip}:${hostPort}`)
    if (!v.ok) return setHostPortErr(v.error)
    setHostPortErr(undefined)
    void run((id) => api.setTvPort(id, tv.id, v.value.ip, v.value.port))
  }

  const saveName = async (): Promise<void> => {
    const v = validateTvName(renaming)
    if (!v.ok) return setMsg({ ok: false, text: v.error })
    await api.renameTv(tv.id, v.value)
    setRenaming(undefined)
  }

  const info = tv.info
  const needsPort = tv.method === 'wireless' && (tv.state === 'port_changed' || tv.state === 'unreachable')

  return (
    <div className="card stack">
      <div className="row">
        {renaming === undefined ? (
          <h2 style={{ margin: 0 }}>{tv.name}</h2>
        ) : (
          <>
            <input type="text" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
            <button className="btn small primary" onClick={saveName}>
              Save
            </button>
            <button className="btn small" onClick={() => setRenaming(undefined)}>
              Cancel
            </button>
          </>
        )}
        <span className="spacer" />
        <StatusChip tv={tv} />
      </div>
      <div className="muted small mono">
        {tv.ip}:{tv.port} · {tv.method === 'wireless' ? 'Wireless debugging' : 'Network debugging'}
        {tv.model ? ` · ${tv.model}` : ''}
      </div>

      <Notice tone={copy.tone === 'ok' ? 'ok' : copy.tone === 'bad' ? 'bad' : copy.tone === 'warn' ? 'warn' : 'info'}>
        <b>Next step: </b>
        {copy.nextStep}
        {tv.message && tv.message !== copy.nextStep && <div className="small muted" style={{ marginTop: 6 }}>{tv.message}</div>}
      </Notice>

      {busy && <ProgressBar />}

      <div className="row">
        {tv.state !== 'connected' && (
          <button className="btn primary" disabled={busy} onClick={() => run((id) => api.reconnect(id, tv.id))}>
            {tv.state === 'disconnected' ? 'Connect' : 'Reconnect'}
          </button>
        )}
        {tv.method === 'wireless' && tv.state === 'not_paired' && (
          <button className="btn primary" onClick={onPairAgain}>
            Pair…
          </button>
        )}
        {tv.state === 'connected' && (
          <button className="btn" disabled={busy} onClick={() => api.refreshInfo(tv.id)}>
            Refresh details
          </button>
        )}
        {(tv.state === 'connected' || tv.state === 'unauthorized') && (
          <button className="btn" disabled={busy} onClick={() => run(() => api.disconnect(tv.id))}>
            Disconnect
          </button>
        )}
        {jobId && (
          <button className="btn" onClick={() => api.cancelJob(jobId)}>
            Cancel
          </button>
        )}
        <span className="spacer" />
        <button className="btn small" onClick={() => setRenaming(tv.name)}>
          Rename
        </button>
        {confirmForget ? (
          <>
            <button className="btn small danger" onClick={() => api.forget(tv.id)}>
              Really forget?
            </button>
            <button className="btn small" onClick={() => setConfirmForget(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn small danger" onClick={() => setConfirmForget(true)}>
            Forget
          </button>
        )}
      </div>

      {needsPort && (
        <div className="stack">
          <span className="small muted">
            Enter the <b>IP address &amp; Port</b> shown on the TV’s Wireless debugging screen:
          </span>
          <div className="row" style={{ alignItems: 'start' }}>
            <label className="field">
              <input
                type="text"
                placeholder={`${tv.ip}:41235`}
                value={hostPort}
                onChange={(e) => setHostPort(e.target.value)}
                aria-invalid={!!hostPortErr}
                spellCheck={false}
              />
              {hostPortErr && <span className="field-error">{hostPortErr}</span>}
            </label>
            <button className="btn" disabled={busy} onClick={submitPort}>
              Use this port
            </button>
          </div>
        </div>
      )}

      {msg && <Notice tone={msg.ok ? 'ok' : 'bad'}>{msg.text}</Notice>}

      {info && (
        <>
          <h3>TV details</h3>
          <dl className="kv">
            <dt>Model</dt>
            <dd>{[info.manufacturer, info.model].filter(Boolean).join(' ') || '—'}</dd>
            <dt>Android</dt>
            <dd>
              {info.androidVersion ?? '—'}
              {info.sdk ? ` (API ${info.sdk})` : ''}
            </dd>
            <dt>CPU ABIs</dt>
            <dd className="mono">{info.abis.join(', ') || '—'}</dd>
            <dt>Screen density</dt>
            <dd>{info.density ? `${info.density} dpi` : '—'}</dd>
            <dt>Free storage</dt>
            <dd>
              {formatBytes(info.freeBytes)}
              {info.totalBytes ? ` of ${formatBytes(info.totalBytes)}` : ''}
            </dd>
          </dl>
        </>
      )}
    </div>
  )
}

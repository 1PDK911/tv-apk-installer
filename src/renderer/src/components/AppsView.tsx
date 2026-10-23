import { useCallback, useEffect, useState } from 'react'
import type { TvApp, TvView } from '@shared/types'
import { api, errorText, newJobId } from '../util'
import { Modal, Notice, ProgressBar, useJobProgress } from './common'

type RowMsg = { ok: boolean; text: string; path?: string }

export function AppsView({ tv }: { tv?: TvView }) {
  const [apps, setApps] = useState<TvApp[]>()
  const [error, setError] = useState<string>()
  const [loadingJob, setLoadingJob] = useState<string>()
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [msgs, setMsgs] = useState<Record<string, RowMsg>>({})
  const [confirmUninstall, setConfirmUninstall] = useState<TvApp>()
  const [saveJob, setSaveJob] = useState<{ pkg: string; jobId: string }>()
  const saveProgress = useJobProgress(saveJob?.jobId)
  const connected = tv?.state === 'connected'

  const load = useCallback(async () => {
    if (!tv || tv.state !== 'connected') return
    const jobId = newJobId()
    setLoadingJob(jobId)
    setError(undefined)
    try {
      setApps(await api.listApps(jobId, tv.id))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoadingJob(undefined)
    }
  }, [tv?.id, tv?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setApps(undefined)
    void load()
  }, [load])

  const act = async (pkg: string, label: string, fn: () => Promise<RowMsg>): Promise<void> => {
    setBusy((b) => ({ ...b, [pkg]: label }))
    try {
      const m = await fn()
      setMsgs((x) => ({ ...x, [pkg]: m }))
    } catch (e) {
      setMsgs((x) => ({ ...x, [pkg]: { ok: false, text: errorText(e) } }))
    } finally {
      setBusy((b) => {
        const { [pkg]: _, ...rest } = b
        return rest
      })
    }
  }

  if (!connected) {
    return <div className="card muted">Connect to a TV to see its apps.</div>
  }

  const shown = (apps ?? []).filter((a) => a.packageName.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Apps on {tv!.name}</h2>
        <span className="muted small">{apps ? `${apps.length} installed by you` : ''}</span>
        <span className="spacer" />
        <input type="text" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter apps" />
        {loadingJob ? (
          <button className="btn" onClick={() => api.cancelJob(loadingJob)}>
            Cancel
          </button>
        ) : (
          <button className="btn" onClick={load}>
            Refresh
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Apps you or the Play Store installed. System apps aren’t listed. adb can’t read app names without downloading each
        app, so they’re shown by package name.
      </p>
      {loadingJob && <ProgressBar />}
      {error && <Notice tone="bad">{error}</Notice>}
      {apps && apps.length === 0 && <div className="muted">No user-installed apps.</div>}
      {shown.length > 0 && (
        <table className="apps">
          <thead>
            <tr>
              <th>Package</th>
              <th>Version</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const b = busy[a.packageName]
              const m = msgs[a.packageName]
              return (
                <tr key={a.packageName}>
                  <td>
                    <div className="mono">{a.packageName}</div>
                    {!a.enabled && <span className="chip muted">disabled</span>}
                    {m && (
                      <div className={m.ok ? 'muted small' : 'field-error'}>
                        {m.text}{' '}
                        {m.path && (
                          <button className="btn link small" onClick={() => api.showInFolder(m.path!)}>
                            Show in folder
                          </button>
                        )}
                      </div>
                    )}
                    {saveJob?.pkg === a.packageName && (
                      <div className="row small" style={{ marginTop: 4 }}>
                        <span className="muted">{saveProgress?.stage ?? 'Copying…'}</span>
                        <div style={{ flex: 1, minWidth: 80 }}>
                          <ProgressBar fraction={saveProgress?.fraction} />
                        </div>
                        <button className="btn small" onClick={() => api.cancelJob(saveJob.jobId)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {a.versionName ?? '—'}
                    {a.versionCode !== undefined && <div className="muted small">code {a.versionCode}</div>}
                  </td>
                  <td className="small">{a.source}</td>
                  <td className="actions">
                    <button
                      className="btn small"
                      disabled={!!b}
                      onClick={() =>
                        act(a.packageName, 'open', async () => {
                          const r = await api.launchApp(tv!.id, a.packageName)
                          return { ok: r.ok, text: r.message }
                        })
                      }
                    >
                      Open
                    </button>{' '}
                    <button
                      className="btn small"
                      disabled={!!b}
                      onClick={() =>
                        act(a.packageName, 'stop', async () => {
                          const r = await api.forceStopApp(tv!.id, a.packageName)
                          return { ok: r.ok, text: r.ok ? 'Force-stopped.' : r.message }
                        })
                      }
                    >
                      Force stop
                    </button>{' '}
                    <button
                      className="btn small"
                      disabled={!!b || !!saveJob}
                      onClick={() =>
                        act(a.packageName, 'save', async () => {
                          const jobId = newJobId()
                          setSaveJob({ pkg: a.packageName, jobId })
                          try {
                            const r = await api.saveAppCopy(jobId, tv!.id, a.packageName, a.versionName ?? null)
                            return { ok: r.ok, text: r.message, path: r.path }
                          } finally {
                            setSaveJob(undefined)
                          }
                        })
                      }
                    >
                      Save APK
                    </button>{' '}
                    <button className="btn small danger" disabled={!!b} onClick={() => setConfirmUninstall(a)}>
                      Uninstall
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {confirmUninstall && (
        <Modal title="Uninstall app?" onClose={() => setConfirmUninstall(undefined)}>
          <p>
            Remove <span className="mono">{confirmUninstall.packageName}</span> from {tv!.name}?
          </p>
          <Notice tone="bad">Its data — sign-ins, settings, downloads and progress — will be permanently deleted.</Notice>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmUninstall(undefined)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                const a = confirmUninstall
                setConfirmUninstall(undefined)
                void act(a.packageName, 'uninstall', async () => {
                  const r = await api.uninstallApp(tv!.id, a.packageName)
                  if (r.ok) setApps((list) => list?.filter((x) => x.packageName !== a.packageName))
                  return { ok: r.ok, text: r.message }
                })
              }}
            >
              Uninstall
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

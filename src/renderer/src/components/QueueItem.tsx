import { useState } from 'react'
import type { InstallOptions, InstallRemedy, TvView } from '@shared/types'
import { androidName } from '@shared/android'
import { api, formatBytes } from '../util'
import { Notice, ProgressBar, useJobProgress } from './common'
import type { Item } from './InstallView'

function abiSummary(info: { abis: string[]; bundle?: { splits: { type: string; value?: string }[] } }): string {
  const abis = info.bundle ? info.bundle.splits.filter((s) => s.type === 'abi').map((s) => s.value ?? '') : info.abis
  return abis.length ? abis.join(' · ') : 'Any processor'
}

const REMEDY: Record<InstallRemedy, { button: string; warning: string; options: InstallOptions; tone: 'warn' | 'bad' }> = {
  uninstall_reinstall: {
    button: 'Uninstall & reinstall',
    warning:
      'This removes the app that’s on the TV first. Its data — sign-ins, settings, downloads and progress — will be permanently deleted.',
    options: { uninstallFirst: true },
    tone: 'bad'
  },
  bypass_low_target_sdk: {
    button: 'Install anyway (bypass block)',
    warning:
      'Android blocks this app because it was built for an old Android version and skips newer security protections. Only continue if you trust where this app came from.',
    options: { bypassLowTargetSdk: true },
    tone: 'warn'
  },
  allow_test: {
    button: 'Install test build',
    warning: 'Test builds are meant for developers and may be unstable or insecure. Only continue if you trust this build.',
    options: { allowTest: true },
    tone: 'warn'
  }
}

export function QueueItem({
  item,
  tv,
  busy,
  blocked,
  onInstall,
  onOverride,
  onRemove
}: {
  item: Item
  tv?: TvView
  busy: boolean
  blocked: boolean
  onInstall: (opts?: InstallOptions) => Promise<boolean>
  onOverride: (v: boolean) => void
  onRemove: () => void
}) {
  const [confirm, setConfirm] = useState<InstallRemedy>()
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string }>()
  const [showDetails, setShowDetails] = useState(false)
  const progress = useJobProgress(item.status === 'installing' ? item.jobId : undefined)
  const info = item.inspection?.info
  const failure = item.result?.failure
  const connected = tv?.state === 'connected'
  const [lastOptions, setLastOptions] = useState<InstallOptions>({})

  const statusChip = {
    inspecting: <span className="chip muted">Reading…</span>,
    ready: blocked ? <span className="chip warn">Check warnings</span> : <span className="chip ok">Ready</span>,
    invalid: <span className="chip bad">Can’t install</span>,
    installing: <span className="chip muted">Installing…</span>,
    installed: <span className="chip ok">Installed</span>,
    failed: <span className="chip bad">Failed</span>,
    cancelled: <span className="chip muted">Cancelled</span>
  }[item.status]

  const run = async (opts: InstallOptions = {}): Promise<void> => {
    setLastOptions(opts)
    setConfirm(undefined)
    setLaunchMsg(undefined)
    await onInstall(opts)
  }

  const launch = async (): Promise<void> => {
    if (!tv || !item.result?.packageName) return
    const r = await api.launchApp(tv.id, item.result.packageName)
    setLaunchMsg({ ok: r.ok, text: r.message })
  }

  const title = info?.label ?? info?.packageName ?? item.file.name
  const warnings = item.inspection?.checks.filter((c) => c.level !== 'ok') ?? []
  const hasBlocking = warnings.some((c) => c.level === 'warn' || c.level === 'block')

  return (
    <div className="card queue-item">
      <div className="queue-head">
        {info?.icon ? <img className="app-icon" src={info.icon} alt="" /> : <div className="app-icon">APK</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {info ? (
              <>
                <span className="mono">{info.packageName}</span>
                {info.versionName ? ` · v${info.versionName}` : ''} · {formatBytes(item.file.size)} · {item.file.name}
              </>
            ) : (
              `${item.file.name} · ${formatBytes(item.file.size)}`
            )}
          </div>
        </div>
        <div className="row">
          {statusChip}
          {item.status === 'installing' ? (
            <button className="btn small" onClick={() => item.jobId && api.cancelJob(item.jobId)}>
              Cancel
            </button>
          ) : (
            <>
              {(item.status === 'ready' || item.status === 'failed' || item.status === 'cancelled' || item.status === 'installed') && (
                <button
                  className={`btn small ${item.status === 'ready' ? 'primary' : ''}`}
                  disabled={!connected || busy || blocked}
                  title={!connected ? 'Connect to a TV first' : blocked ? 'Review the warnings below first' : undefined}
                  onClick={() => run()}
                >
                  {item.status === 'ready' ? 'Install' : 'Install again'}
                </button>
              )}
              <button className="btn small" onClick={onRemove} disabled={busy} aria-label="Remove from queue">
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {item.status === 'inspecting' && <ProgressBar />}
      {item.inspection?.error && <Notice tone="bad">{item.inspection.error}</Notice>}

      {warnings.length > 0 && item.status !== 'installed' && (
        <div className="checks">
          {warnings.map((c) => (
            <div key={c.id} className={`check ${c.level === 'block' ? 'bad' : c.level}`}>
              <span className="dot" />
              <div>
                <b>{c.title}</b>
                {c.detail && <div className="muted small">{c.detail}</div>}
              </div>
            </div>
          ))}
          {hasBlocking && item.status === 'ready' && (
            <label className="row small">
              <input type="checkbox" checked={item.overridden} onChange={(e) => onOverride(e.target.checked)} />
              I understand — install anyway
            </label>
          )}
        </div>
      )}

      {item.status === 'installing' && (
        <div className="stack">
          {progress?.steps && (
            <div className="steps-inline">
              {progress.steps.map((s, i) => (
                <span key={s} className={i < (progress.stepIndex ?? 0) ? 'done' : i === progress.stepIndex ? 'active' : ''}>
                  {i < (progress.stepIndex ?? 0) ? '✓ ' : ''}
                  {s}
                </span>
              ))}
            </div>
          )}
          <ProgressBar fraction={progress?.fraction} />
          {progress?.detail && <span className="muted small">{progress.detail}</span>}
        </div>
      )}

      {item.status === 'installed' && item.result && (
        <div className="row">
          <Notice tone="ok">✓ {item.result.message}</Notice>
          <button className="btn primary" onClick={launch}>
            Open on TV
          </button>
          {launchMsg && <span className={launchMsg.ok ? 'muted small' : 'field-error'}>{launchMsg.text}</span>}
        </div>
      )}

      {item.status === 'cancelled' && <Notice tone="info">Cancelled. Nothing was changed on the TV.</Notice>}

      {item.status === 'failed' && item.result && (
        <Notice tone="bad">
          <b>{failure?.title ?? item.result.message}</b>
          {failure && (
            <>
              <div style={{ marginTop: 4 }}>{failure.explanation}</div>
              <div style={{ marginTop: 4 }}>
                <b>Fix: </b>
                {failure.fix}
              </div>
              <div className="muted small mono" style={{ marginTop: 6 }}>
                {failure.code}
              </div>
            </>
          )}
          {failure?.remedy && !confirm && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" disabled={!connected || busy} onClick={() => setConfirm(failure.remedy)}>
                {REMEDY[failure.remedy].button}…
              </button>
            </div>
          )}
        </Notice>
      )}

      {confirm && (
        <Notice tone={REMEDY[confirm].tone}>
          <b>Are you sure?</b> {REMEDY[confirm].warning}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => run({ ...lastOptions, ...REMEDY[confirm].options })}>
              {REMEDY[confirm].button}
            </button>
            <button className="btn" onClick={() => setConfirm(undefined)}>
              Cancel
            </button>
          </div>
        </Notice>
      )}

      {info && item.status !== 'installed' && (
        <div className="facts">
          <span title="Minimum Android version / version the app targets">
            {info.minSdk ? `${androidName(info.minSdk).replace(/ \(API \d+\)/, '')}+` : 'Any Android'}
            {info.targetSdk ? ` · targets API ${info.targetSdk}` : ''}
          </span>
          <span title="Processor types the app has native code for">
            {info.abis.length || info.bundle ? abiSummary(info) : 'Any processor'}
          </span>
          <span className={info.tv.leanbackLauncher ? 'good' : 'warn'}>
            {info.tv.leanbackLauncher ? '✓ Built for TV' : 'Phone app'}
          </span>
          {item.inspection?.installed?.installed && (
            <span>Installed: v{item.inspection.installed.versionName ?? item.inspection.installed.versionCode}</span>
          )}
        </div>
      )}

      {info && (
        <div>
          <button className="btn link small" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>
            {showDetails ? 'Hide details' : 'More details'}
          </button>
          {showDetails && (
            <dl className="kv small" style={{ marginTop: 8 }}>
              <dt>Package</dt>
              <dd className="mono">{info.packageName}</dd>
              <dt>Version</dt>
              <dd>
                {info.versionName ?? '—'} <span className="muted">(code {info.versionCode ?? '—'})</span>
              </dd>
              <dt>Min / target</dt>
              <dd>
                {androidName(info.minSdk)} / {androidName(info.targetSdk)}
              </dd>
              <dt>Native code</dt>
              <dd className="mono">
                {info.abis.length || info.bundle?.splits.some((x) => x.type === 'abi')
                  ? abiSummary(info).split(' · ').join(', ')
                  : 'none (runs on any processor)'}
              </dd>
              <dt>Built for TV</dt>
              <dd>
                {info.tv.leanbackLauncher ? 'Yes — shows on the TV home screen (LEANBACK_LAUNCHER)' : 'No — no TV launcher entry'}
                {` · leanback feature ${info.tv.leanbackFeature}`}
                {info.tv.touchscreenRequired ? ' · requires touchscreen' : ''}
              </dd>
              {(info.testOnly || info.debuggable) && (
                <>
                  <dt>Build</dt>
                  <dd>{[info.testOnly && 'test-only', info.debuggable && 'debuggable'].filter(Boolean).join(', ')}</dd>
                </>
              )}
              <dt>Size</dt>
              <dd>{formatBytes(info.sizeBytes)}</dd>
              <dt>SHA-256</dt>
              <dd className="mono" style={{ wordBreak: 'break-all' }}>
                {info.sha256}
              </dd>
              {info.bundle && (
                <>
                  <dt>Splits</dt>
                  <dd>
                    {info.bundle.splits
                      .filter((s) => s.selected)
                      .map((s) => s.name)
                      .join(', ')}
                    {info.bundle.selectionNote && <div className="muted">{info.bundle.selectionNote}</div>}
                  </dd>
                  {info.bundle.obbs.length > 0 && (
                    <>
                      <dt>Game data</dt>
                      <dd>{info.bundle.obbs.map((o) => `${o.name} (${formatBytes(o.sizeBytes)})`).join(', ')}</dd>
                    </>
                  )}
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}

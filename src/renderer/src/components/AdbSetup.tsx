import { useState } from 'react'
import type { AdbStatus } from '@shared/types'
import { api, errorText, newJobId } from '../util'
import { ExternalLink, Notice, ProgressBar, useJobProgress } from './common'

export function AdbSetup({ status, onReady }: { status: AdbStatus; onReady: (s: AdbStatus) => void }) {
  const [jobId, setJobId] = useState<string>()
  const [result, setResult] = useState<{ ok: boolean; message: string }>()
  const progress = useJobProgress(jobId)

  const download = async (): Promise<void> => {
    const id = newJobId()
    setJobId(id)
    setResult(undefined)
    try {
      const r = await api.downloadPlatformTools(id)
      setResult(r)
      if (r.ok && r.status) onReady(r.status)
    } catch (e) {
      setResult({ ok: false, message: errorText(e) })
    } finally {
      setJobId(undefined)
    }
  }

  const recheck = async (): Promise<void> => {
    const s = await api.adbRecheck()
    if (s.found) onReady(s)
    else setResult({ ok: false, message: 'Still can’t find adb. Install platform-tools or use the download button.' })
  }

  return (
    <div className="card stack" style={{ maxWidth: 680 }}>
      <h2>One-time setup: get adb</h2>
      <p className="muted" style={{ margin: 0 }}>
        This app uses <b>adb</b>, Google’s official Android Debug Bridge, to talk to your TV. It wasn’t found on this
        computer.
      </p>
      {status.error && <Notice tone="bad">Found adb at {status.path}, but it didn’t run: {status.error}</Notice>}
      <div className="notice info small">
        The app can download Google’s <b>SDK Platform-Tools</b> for Windows from <span className="mono">dl.google.com</span>{' '}
        (about 7 MB) into its own data folder, verify its checksum, and use it. Nothing else is downloaded. By downloading you
        accept Google’s{' '}
        <ExternalLink href="https://developer.android.com/studio/terms">Android SDK terms</ExternalLink> (
        <ExternalLink href="https://developer.android.com/studio/releases/platform-tools">release notes</ExternalLink>).
      </div>
      {jobId ? (
        <div className="stack">
          <div className="row">
            <span>{progress?.stage ?? 'Starting…'}</span>
            <span className="spacer" />
            <button className="btn small" onClick={() => jobId && api.cancelJob(jobId)}>
              Cancel
            </button>
          </div>
          <ProgressBar fraction={progress?.fraction} />
        </div>
      ) : (
        <div className="row">
          <button className="btn primary" onClick={download}>
            Download platform-tools from Google
          </button>
          <button className="btn" onClick={recheck}>
            I installed adb myself, check again
          </button>
        </div>
      )}
      {result && <Notice tone={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
    </div>
  )
}

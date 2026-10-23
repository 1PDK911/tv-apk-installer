import { useCallback, useEffect, useState } from 'react'
import type { AdbStatus, TvView } from '@shared/types'
import { describeState } from '@shared/status'
import { AdbSetup } from './components/AdbSetup'
import { AddTvDialog } from './components/AddTvDialog'
import { AppsView } from './components/AppsView'
import { InstallView } from './components/InstallView'
import { StatusChip } from './components/common'
import { LogDrawer } from './components/LogDrawer'
import { SetupGuide } from './components/SetupGuide'
import { TvPanel } from './components/TvPanel'
import { api } from './util'

type View = 'install' | 'apps'

export function App() {
  const [adb, setAdb] = useState<AdbStatus>()
  const [tvs, setTvs] = useState<TvView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [view, setView] = useState<View>('install')
  const [reminderDismissed, setReminderDismissed] = useState(false)

  useEffect(() => {
    void api.adbStatus().then(setAdb)
    void api.listTvs().then(setTvs)
    void api.getSelectedTv().then(setSelectedId)
    void api.getSetupGuideSeen().then((seen) => {
      if (!seen) setShowGuide(true)
    })
    return api.onTvs(setTvs)
  }, [])

  // The main process finishes detecting adb shortly after the window opens.
  useEffect(() => {
    if (adb?.found) return
    const t = setInterval(() => void api.adbStatus().then((s) => s.found && setAdb(s)), 1500)
    return () => clearInterval(t)
  }, [adb?.found])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    void api.selectTv(id)
  }, [])

  // Keep a valid selection: prefer the saved one, then a connected TV, then the first.
  useEffect(() => {
    if (selectedId && tvs.some((t) => t.id === selectedId)) return
    const next = tvs.find((t) => t.state === 'connected') ?? tvs[0]
    if (next) select(next.id)
    else if (selectedId) setSelectedId(null)
  }, [tvs, selectedId, select])

  const selected = tvs.find((t) => t.id === selectedId)
  const anyConnected = tvs.some((t) => t.state === 'connected' || t.state === 'unauthorized')

  const closeGuide = (): void => {
    setShowGuide(false)
    void api.setSetupGuideSeen()
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">📺 TV APK Installer</span>
        <nav className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={view === 'install'} onClick={() => setView('install')}>
            Install
          </button>
          <button className="tab" role="tab" aria-selected={view === 'apps'} onClick={() => setView('apps')}>
            Apps on TV
          </button>
        </nav>
        <span className="spacer" />
        {tvs.length > 0 && (
          <>
            <select
              aria-label="TV"
              value={selectedId ?? ''}
              onChange={(e) => select(e.target.value || null)}
              style={{ maxWidth: 240 }}
            >
              {tvs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {describeState(t.state, t.method).label}
                </option>
              ))}
            </select>
            {selected && <StatusChip tv={selected} />}
          </>
        )}
        <button className="btn" onClick={() => setShowAdd(true)} disabled={!adb?.found}>
          + Add TV
        </button>
        <button className="btn" onClick={() => setShowGuide(true)}>
          Setup guide
        </button>
      </header>

      {anyConnected && !reminderDismissed ? (
        <div className="reminder" role="note">
          <span>
            🔒 When you’re finished, turn off <b>Wireless debugging</b> / <b>USB debugging</b> in the TV’s Developer options.
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => setReminderDismissed(true)}>
            Dismiss
          </button>
        </div>
      ) : (
        <div />
      )}

      <main className="main">
        {!adb ? (
          <div className="muted">Starting…</div>
        ) : !adb.found ? (
          <AdbSetup status={adb} onReady={setAdb} />
        ) : (
          <div className="two-col">
            <div className="stack">
              <div className="card stack">
                <div className="row">
                  <h2 style={{ margin: 0 }}>Your TVs</h2>
                  <span className="spacer" />
                  <button className="btn small" onClick={() => setShowAdd(true)}>
                    + Add
                  </button>
                </div>
                {tvs.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No TVs yet. Follow the <button className="btn link" onClick={() => setShowGuide(true)}>setup guide</button>,
                    then click <b>Add TV</b>.
                  </p>
                ) : (
                  <div className="tv-list" role="listbox" aria-label="TVs">
                    {tvs.map((t) => (
                      <button
                        key={t.id}
                        className="tv-item"
                        role="option"
                        aria-selected={t.id === selectedId}
                        onClick={() => select(t.id)}
                      >
                        <span>{t.name}</span>
                        <StatusChip tv={t} />
                        <span className="muted small mono">
                          {t.ip}:{t.port}
                        </span>
                        <span className="muted small">{t.model ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="muted small">adb {adb.version} · {adb.source === 'app-data' ? 'downloaded by this app' : adb.path}</div>
              </div>
              {selected && <TvPanel key={selected.id} tv={selected} onPairAgain={() => setShowAdd(true)} />}
            </div>
            <div className="stack">
              <div hidden={view !== 'install'}>
                <InstallView tv={selected} />
              </div>
              {view === 'apps' && <AppsView tv={selected} />}
            </div>
          </div>
        )}
      </main>

      <LogDrawer />

      {showAdd && <AddTvDialog onClose={() => setShowAdd(false)} onAdded={(id) => id && select(id)} />}
      {showGuide && <SetupGuide onClose={closeGuide} />}
    </div>
  )
}

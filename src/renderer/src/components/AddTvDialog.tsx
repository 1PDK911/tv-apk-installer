import { type InputHTMLAttributes, useEffect, useState } from 'react'
import type { ActionResult, ConnectMethod, DiscoveredService } from '@shared/types'
import { validateIp, validatePairingCode, validatePort, validateTvName } from '@shared/validation'
import { api, errorText, newJobId } from '../util'
import { Modal, Notice, ProgressBar } from './common'

type Field = 'ip' | 'pairingPort' | 'code' | 'connectPort' | 'port' | 'name'

export function AddTvDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (tvId?: string) => void }) {
  const [method, setMethod] = useState<ConnectMethod>('wireless')
  const [alreadyPaired, setAlreadyPaired] = useState(false)
  const [ip, setIp] = useState('')
  const [pairingPort, setPairingPort] = useState('')
  const [code, setCode] = useState('')
  const [connectPort, setConnectPort] = useState('')
  const [port, setPort] = useState('5555')
  const [name, setName] = useState('Living room TV')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [jobId, setJobId] = useState<string>()
  const [result, setResult] = useState<ActionResult>()
  const [services, setServices] = useState<DiscoveredService[]>()

  const scan = async (): Promise<void> => {
    setServices(undefined)
    setServices(await api.discover().catch(() => []))
  }
  useEffect(() => {
    void scan()
  }, [])

  const pickService = (s: DiscoveredService): void => {
    setIp(s.ip)
    if (s.type === 'pairing') {
      setMethod('wireless')
      setAlreadyPaired(false)
      setPairingPort(String(s.port))
    } else if (s.type === 'connect') {
      setMethod('wireless')
      setConnectPort(String(s.port))
    } else {
      setMethod('classic')
      setPort(String(s.port))
    }
  }

  const validate = (): boolean => {
    const e: Partial<Record<Field, string>> = {}
    const put = (f: Field, v: { ok: boolean; error?: string }): void => {
      if (!v.ok) e[f] = (v as { error: string }).error
    }
    put('ip', validateIp(ip))
    put('name', validateTvName(name))
    if (method === 'wireless') {
      put('connectPort', validatePort(connectPort))
      if (!alreadyPaired) {
        put('pairingPort', validatePort(pairingPort))
        put('code', validatePairingCode(code))
      }
    } else {
      put('port', validatePort(port))
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (): Promise<void> => {
    if (!validate()) return
    const id = newJobId()
    setJobId(id)
    setResult(undefined)
    try {
      let r: ActionResult
      if (method === 'wireless' && !alreadyPaired) {
        r = await api.pair(id, {
          ip: ip.trim(),
          pairingPort: Number(pairingPort),
          code: code.replace(/\s/g, ''),
          connectPort: Number(connectPort),
          name
        })
      } else {
        r = await api.connect(id, {
          ip: ip.trim(),
          port: Number(method === 'wireless' ? connectPort : port),
          method,
          name
        })
      }
      setResult(r)
      if (r.ok && r.tv?.state === 'connected') onAdded(r.tv.id)
      else if (r.tv) onAdded(r.tv.id)
    } catch (e) {
      setResult({ ok: false, message: errorText(e) })
    } finally {
      setJobId(undefined)
    }
  }

  const input = (
    f: Field,
    label: string,
    value: string,
    set: (v: string) => void,
    props: Partial<InputHTMLAttributes<HTMLInputElement>> = {}
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          set(e.target.value)
          if (errors[f]) setErrors({ ...errors, [f]: undefined })
        }}
        aria-invalid={!!errors[f]}
        spellCheck={false}
        autoComplete="off"
        {...props}
      />
      {errors[f] && <span className="field-error">{errors[f]}</span>}
    </label>
  )

  const busy = !!jobId
  const discovered = (services ?? []).filter((s) => !(method === 'classic' && s.type !== 'legacy'))

  return (
    <Modal title="Add a TV" onClose={busy ? () => undefined : onClose} wide>
      <div className="stack">
        <div className="segmented" role="group" aria-label="Connection method">
          <button aria-pressed={method === 'wireless'} onClick={() => setMethod('wireless')} disabled={busy}>
            Wireless debugging
          </button>
          <button aria-pressed={method === 'classic'} onClick={() => setMethod('classic')} disabled={busy}>
            Network debugging (port 5555)
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {method === 'wireless'
            ? 'For TVs whose Developer options have a "Wireless debugging" entry (Android TV 13 and newer, e.g. Google TV Streamer).'
            : 'For TVs with "USB debugging" or "Network debugging" but no "Wireless debugging" entry (e.g. Chromecast with Google TV, many older Android TVs).'}
        </p>

        <div className="card" style={{ background: 'var(--panel-2)', padding: 12 }}>
          <div className="row">
            <b className="small">TVs found on your network</b>
            <span className="spacer" />
            <button className="btn small" onClick={scan} disabled={busy}>
              Scan again
            </button>
          </div>
          {services === undefined ? (
            <div style={{ marginTop: 8 }}>
              <ProgressBar />
            </div>
          ) : discovered.length === 0 ? (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              {method === 'wireless'
                ? 'Nothing found automatically. Open Wireless debugging on the TV and click Scan again, or type the details below.'
                : 'Nothing found automatically. Type the TV’s IP address below.'}
            </p>
          ) : (
            <div className="discovered" style={{ marginTop: 8 }}>
              {discovered.map((s) => (
                <button key={`${s.instance}-${s.type}-${s.port}`} className="tv-item" onClick={() => pickService(s)}>
                  <span>
                    {s.ip}:{s.port}{' '}
                    <span className="muted small">
                      {s.type === 'pairing' ? 'pairing screen open' : s.type === 'connect' ? 'wireless debugging' : 'network debugging'}
                    </span>
                  </span>
                  <span className="muted small mono">{s.serialNo ?? s.instance}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {method === 'wireless' ? (
          <>
            <label className="row small">
              <input type="checkbox" checked={alreadyPaired} onChange={(e) => setAlreadyPaired(e.target.checked)} />
              This computer is already paired with this TV (just connect)
            </label>
            {!alreadyPaired && (
              <Notice tone="info">
                <b>Step 1: pair.</b> On the TV: Developer options → Wireless debugging → <b>Pair device with pairing code</b>.
                Enter the IP address, port and 6-digit code from that screen. <b>Keep that screen open</b> until pairing
                finishes.
              </Notice>
            )}
            <div className="row" style={{ alignItems: 'start' }}>
              {input('ip', 'TV IP address', ip, setIp, { placeholder: '192.168.1.42', style: { width: 170 } })}
              {!alreadyPaired &&
                input('pairingPort', 'Pairing port', pairingPort, setPairingPort, {
                  placeholder: '37145',
                  style: { width: 100 },
                  inputMode: 'numeric'
                })}
              {!alreadyPaired &&
                input('code', 'Pairing code', code, setCode, {
                  placeholder: '000000',
                  className: 'code-input',
                  inputMode: 'numeric',
                  maxLength: 7
                })}
            </div>
            <Notice tone="info">
              <b>{alreadyPaired ? 'Connect.' : 'Step 2: connect.'}</b> Go back to the main <b>Wireless debugging</b> screen
              on the TV and enter the port from <b>IP address &amp; Port</b> (it’s a different number from the pairing port).
            </Notice>
            <div className="row" style={{ alignItems: 'start' }}>
              {input('connectPort', 'Wireless debugging port', connectPort, setConnectPort, {
                placeholder: '41235',
                style: { width: 120 },
                inputMode: 'numeric'
              })}
              {input('name', 'Name for this TV', name, setName, { style: { width: 220 } })}
            </div>
          </>
        ) : (
          <>
            <Notice tone="info">
              On the TV, turn on <b>USB debugging</b> (or <b>Network debugging</b>) in Developer options. Then enter the TV’s
              IP address. After you click Connect, look at the TV and approve <b>Allow debugging?</b> with{' '}
              <b>Always allow from this computer</b> ticked.
            </Notice>
            <div className="row" style={{ alignItems: 'start' }}>
              {input('ip', 'TV IP address', ip, setIp, { placeholder: '192.168.1.42', style: { width: 170 } })}
              {input('port', 'Port', port, setPort, { style: { width: 90 }, inputMode: 'numeric' })}
              {input('name', 'Name for this TV', name, setName, { style: { width: 220 } })}
            </div>
          </>
        )}

        {busy && (
          <div className="stack">
            <span>
              {method === 'wireless' && !alreadyPaired
                ? 'Pairing… keep the pairing code screen open on the TV.'
                : 'Connecting… if the TV shows "Allow debugging?", approve it.'}
            </span>
            <ProgressBar />
          </div>
        )}
        {result && (
          <Notice tone={result.ok ? (result.tv?.state === 'connected' ? 'ok' : 'warn') : 'bad'}>{result.message}</Notice>
        )}
      </div>
      <div className="modal-actions">
        {busy ? (
          <button className="btn" onClick={() => jobId && api.cancelJob(jobId)}>
            Cancel
          </button>
        ) : (
          <button className="btn" onClick={onClose}>
            {result?.ok ? 'Done' : 'Close'}
          </button>
        )}
        <button className="btn primary" onClick={submit} disabled={busy}>
          {method === 'wireless' && !alreadyPaired ? 'Pair & connect' : 'Connect'}
        </button>
      </div>
    </Modal>
  )
}

import { randomUUID } from 'node:crypto'
import type {
  ActionResult,
  ConnectRequest,
  DiscoveredService,
  PairRequest,
  SavedTv,
  TvState,
  TvView
} from '@shared/types'
import type { AdbClient } from '../adb/client'
import { type ConnectOutcome, type DeviceEntry, serialNoFromMdnsTransport } from '../adb/parse'
import type { Log } from '../log'
import type { Store } from './store'

export const CLASSIC_PORT = 5555

/** Finds the adb transport that belongs to a saved TV. */
export function matchDevice(tv: SavedTv, devices: DeviceEntry[]): DeviceEntry | undefined {
  const exact = devices.find((d) => d.serial === `${tv.ip}:${tv.port}`)
  if (exact) return exact
  if (tv.serialNo) {
    const byMdns = devices.find((d) => serialNoFromMdnsTransport(d.serial) === tv.serialNo)
    if (byMdns) return byMdns
  }
  // Same IP, different port (e.g. wireless debugging port changed and adb auto-connected).
  return devices.find((d) => d.serial.startsWith(`${tv.ip}:`))
}

export function stateFromAdb(state: string): TvState {
  switch (state) {
    case 'device':
      return 'connected'
    case 'unauthorized':
      return 'unauthorized'
    case 'authorizing':
    case 'connecting':
      return 'connecting'
    default:
      return 'offline'
  }
}

/** Picks the wireless-debugging connect service that most likely belongs to `tv`. */
export function findConnectService(tv: SavedTv, services: DiscoveredService[]): DiscoveredService | undefined {
  const connect = services.filter((s) => s.type === 'connect')
  return (
    (tv.serialNo ? connect.find((s) => s.serialNo === tv.serialNo) : undefined) ?? connect.find((s) => s.ip === tv.ip)
  )
}

type Emit = (tvs: TvView[]) => void

/**
 * Owns the list of remembered TVs and their live status. All adb access goes
 * through the injected AdbClient so this class can be tested with a fake runner.
 */
export class DeviceService {
  private tvs = new Map<string, TvView>()
  private busy = new Set<string>()
  private infoLoading = new Set<string>()

  constructor(
    private readonly client: () => AdbClient | undefined,
    private readonly store: Store,
    private readonly log: Log,
    private readonly emit: Emit
  ) {
    for (const t of store.get().tvs) this.tvs.set(t.id, { ...t, state: 'disconnected' })
  }

  list(): TvView[] {
    return [...this.tvs.values()].map((t) => structuredClone(t))
  }

  get(id: string): TvView | undefined {
    return this.tvs.get(id)
  }

  /** The adb serial to use for commands, or an error message if the TV isn't ready. */
  requireConnected(id: string): { serial: string; tv: TvView } | { error: string } {
    const tv = this.tvs.get(id)
    if (!tv) return { error: 'Pick a TV first.' }
    if (tv.state !== 'connected' || !tv.serial) return { error: `${tv.name} isn’t connected.` }
    return { serial: tv.serial, tv }
  }

  private changed(): void {
    this.emit(this.list())
  }

  private set(id: string, patch: Partial<TvView>): void {
    const tv = this.tvs.get(id)
    if (!tv) return
    Object.assign(tv, patch)
    this.changed()
  }

  private async persist(): Promise<void> {
    const saved: SavedTv[] = [...this.tvs.values()].map(
      ({ id, name, ip, port, method, model, serialNo, lastConnectedAt }) => ({
        id,
        name,
        ip,
        port,
        method,
        model,
        serialNo,
        lastConnectedAt
      })
    )
    await this.store.update((d) => {
      d.tvs = saved
    })
  }

  private upsert(req: { ip: string; port: number; method: SavedTv['method']; name: string }): TvView {
    const existing = [...this.tvs.values()].find((t) => t.ip === req.ip)
    if (existing) {
      Object.assign(existing, { port: req.port, method: req.method, name: req.name || existing.name })
      return existing
    }
    const tv: TvView = { id: randomUUID(), ...req, state: 'disconnected' }
    this.tvs.set(tv.id, tv)
    return tv
  }

  /** Polls `adb devices` and updates every TV's state. */
  async refresh(): Promise<void> {
    const adb = this.client()
    if (!adb) return
    let devices: DeviceEntry[]
    try {
      devices = await adb.devices({ timeoutMs: 10_000, quiet: true })
    } catch {
      return
    }
    let dirty = false
    for (const tv of this.tvs.values()) {
      if (this.busy.has(tv.id)) continue
      const dev = matchDevice(tv, devices)
      if (dev) {
        const state = stateFromAdb(dev.state)
        if (tv.state !== state || tv.serial !== dev.serial) {
          tv.state = state
          tv.serial = dev.serial
          tv.message = undefined
          dirty = true
        }
        if (state === 'connected' && !tv.info) void this.loadInfo(tv.id)
      } else if (tv.state === 'connected' || tv.state === 'unauthorized' || tv.state === 'offline') {
        tv.state = 'disconnected'
        tv.serial = undefined
        dirty = true
      }
    }
    if (dirty) this.changed()
  }

  async loadInfo(id: string): Promise<void> {
    const tv = this.tvs.get(id)
    const adb = this.client()
    if (!tv?.serial || !adb || this.infoLoading.has(id)) return
    this.infoLoading.add(id)
    try {
      const info = await adb.info(tv.serial, { timeoutMs: 20_000 })
      const model = [info.manufacturer, info.model].filter(Boolean).join(' ') || tv.model
      this.set(id, { info, model, serialNo: info.serialNo ?? tv.serialNo, lastConnectedAt: Date.now() })
      await this.persist()
    } catch (e) {
      this.log.add('err', `Couldn’t read TV details: ${(e as Error).message}`)
    } finally {
      this.infoLoading.delete(id)
    }
  }

  async discover(): Promise<DiscoveredService[]> {
    const adb = this.client()
    return adb ? adb.mdnsServices() : []
  }

  async pair(req: PairRequest, signal?: AbortSignal): Promise<ActionResult> {
    const adb = this.client()
    if (!adb) return { ok: false, message: 'adb isn’t set up yet.' }
    this.log.info(`Pairing with ${req.ip}:${req.pairingPort}… keep the pairing code screen open on the TV.`)
    const outcome = await adb.pair(req.ip, req.pairingPort, req.code, { signal })
    switch (outcome.kind) {
      case 'paired':
        break
      case 'wrong_code':
        return {
          ok: false,
          message:
            'Pairing failed: the code was wrong or the TV closed the pairing screen. Open "Pair device with pairing code" again and use the new code.'
        }
      case 'cannot_start':
        return {
          ok: false,
          message:
            'Couldn’t reach the pairing port. Check the IP and port on the TV’s pairing screen (it’s different from the main Wireless debugging port) and make sure the screen is still open.'
        }
      default:
        return { ok: false, message: `Pairing failed: ${outcome.text || 'no response from adb.'}` }
    }
    const guidSerial = outcome.guid ? /^adb-(.+)-[A-Za-z0-9]{6}$/.exec(outcome.guid)?.[1] : undefined
    const tv = this.upsert({ ip: req.ip, port: req.connectPort, method: 'wireless', name: req.name })
    if (guidSerial) tv.serialNo = guidSerial
    await this.persist()
    this.changed()
    const connected = await this.connectTv(tv.id, signal)
    return connected.ok ? { ...connected, message: `Paired and ${connected.message.charAt(0).toLowerCase()}${connected.message.slice(1)}` } : connected
  }

  async connect(req: ConnectRequest, signal?: AbortSignal): Promise<ActionResult> {
    const tv = this.upsert(req)
    await this.persist()
    this.changed()
    return this.connectTv(tv.id, signal)
  }

  async connectTv(id: string, signal?: AbortSignal): Promise<ActionResult> {
    const tv = this.tvs.get(id)
    const adb = this.client()
    if (!tv) return { ok: false, message: 'Unknown TV.' }
    if (!adb) return { ok: false, message: 'adb isn’t set up yet.' }
    if (this.busy.has(id)) return { ok: false, message: 'Already connecting…' }
    this.busy.add(id)
    this.set(id, { state: 'connecting', message: undefined })
    try {
      let outcome = await adb.connect(tv.ip, tv.port, { signal })

      // Wireless debugging picks a new port after the TV restarts; try to rediscover it.
      if (tv.method === 'wireless' && outcome.kind !== 'connected' && outcome.kind !== 'auth_failed') {
        const svc = findConnectService(tv, await adb.mdnsServices({ signal }))
        if (svc && svc.port !== tv.port) {
          this.log.info(`Found the TV on a new wireless debugging port: ${svc.ip}:${svc.port}`)
          tv.ip = svc.ip
          tv.port = svc.port
          await this.persist()
          outcome = await adb.connect(tv.ip, tv.port, { signal })
        }
      }

      if (outcome.kind === 'connected') {
        const dev = matchDevice(tv, await adb.devices({ signal }))
        const state = dev ? stateFromAdb(dev.state) : 'connecting'
        tv.serial = dev?.serial ?? `${tv.ip}:${tv.port}`
        this.set(id, { state })
        if (state === 'connected') {
          await this.loadInfo(id)
          return { ok: true, message: `Connected to ${tv.name}.`, tv: structuredClone(this.tvs.get(id)) }
        }
        if (state === 'unauthorized') {
          return {
            ok: true,
            message: 'Almost there: approve the "Allow debugging?" prompt on the TV (tick "Always allow from this computer").',
            tv: structuredClone(tv)
          }
        }
        return { ok: true, message: 'Connected; waiting for the TV to respond…', tv: structuredClone(tv) }
      }
      return this.connectFailed(tv, outcome)
    } catch (e) {
      const cancelled = signal?.aborted
      this.set(id, { state: 'disconnected', message: cancelled ? undefined : (e as Error).message })
      return { ok: false, message: cancelled ? 'Cancelled.' : (e as Error).message }
    } finally {
      this.busy.delete(id)
    }
  }

  private connectFailed(tv: TvView, outcome: Exclude<ConnectOutcome, { kind: 'connected' }>): ActionResult {
    let state: TvState
    let message: string
    switch (outcome.kind) {
      case 'auth_failed':
        if (tv.method === 'wireless') {
          state = 'not_paired'
          message = 'The TV rejected this computer. Pair it again using "Pair device with pairing code".'
        } else {
          state = 'unauthorized'
          message =
            'The TV is asking for permission. Approve "Allow debugging?" on the TV (tick "Always allow from this computer"), then click Reconnect.'
        }
        break
      case 'refused':
        if (tv.method === 'wireless') {
          state = 'port_changed'
          message =
            'The TV refused the connection on that port. Wireless debugging may be off, or its port changed. Open Developer options → Wireless debugging on the TV and check the IP address & Port.'
        } else {
          state = 'unreachable'
          message =
            'The TV refused the connection on port 5555. Turn on USB debugging / Network debugging in Developer options and try again.'
        }
        break
      case 'timeout':
      case 'no_route':
        state = 'unreachable'
        message =
          'No answer from that address. Check the TV is on, the IP address is right, and this computer is on the same Wi-Fi network.'
        break
      case 'bad_host':
        state = 'unreachable'
        message = 'That address isn’t valid.'
        break
      default:
        state = 'unreachable'
        message = `Couldn’t connect: ${outcome.text || 'adb gave no reason.'}`
    }
    this.set(tv.id, { state, message, serial: undefined })
    return { ok: false, message, tv: structuredClone(tv) }
  }

  async disconnect(id: string): Promise<ActionResult> {
    const tv = this.tvs.get(id)
    const adb = this.client()
    if (!tv) return { ok: false, message: 'Unknown TV.' }
    if (adb) {
      if (tv.serial) await adb.disconnect(tv.serial).catch(() => undefined)
      if (tv.serial !== `${tv.ip}:${tv.port}`) await adb.disconnect(`${tv.ip}:${tv.port}`).catch(() => undefined)
    }
    this.set(id, { state: 'disconnected', serial: undefined, message: undefined })
    return { ok: true, message: `Disconnected from ${tv.name}.` }
  }

  async forget(id: string): Promise<ActionResult> {
    const tv = this.tvs.get(id)
    if (!tv) return { ok: false, message: 'Unknown TV.' }
    await this.disconnect(id)
    this.tvs.delete(id)
    await this.persist()
    this.changed()
    return { ok: true, message: `Forgot ${tv.name}.` }
  }

  async rename(id: string, name: string): Promise<ActionResult> {
    const tv = this.tvs.get(id)
    if (!tv) return { ok: false, message: 'Unknown TV.' }
    tv.name = name
    await this.persist()
    this.changed()
    return { ok: true, message: 'Renamed.' }
  }

  /** Update the wireless debugging port by hand (e.g. after a restart). */
  async setPort(id: string, ip: string, port: number): Promise<ActionResult> {
    const tv = this.tvs.get(id)
    if (!tv) return { ok: false, message: 'Unknown TV.' }
    tv.ip = ip
    tv.port = port
    await this.persist()
    return this.connectTv(id)
  }

  async reconnectAll(): Promise<void> {
    await this.refresh()
    await Promise.all(
      [...this.tvs.values()].filter((t) => t.state !== 'connected').map((t) => this.connectTv(t.id).catch(() => undefined))
    )
  }
}

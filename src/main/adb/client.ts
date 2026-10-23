import type { DiscoveredService, TvInfo } from '@shared/types'
import type { AdbResult, AdbRunner, RunOptions } from './runner'
import {
  type ConnectOutcome,
  type DeviceEntry,
  type PairOutcome,
  parseConnect,
  parseDevices,
  parseDf,
  parseGetprop,
  parseMdnsServices,
  parsePair,
  parseVersion,
  parseWmDensity,
  shQuote
} from './parse'

const combined = (r: AdbResult): string => `${r.stdout}\n${r.stderr}`.trim()

/** Typed adb operations on top of an AdbRunner. */
export class AdbClient {
  constructor(readonly runner: AdbRunner) {}

  async version(): Promise<ReturnType<typeof parseVersion>> {
    return parseVersion(combined(await this.runner.run(['version'], { timeoutMs: 15_000 })))
  }

  async devices(opts?: RunOptions): Promise<DeviceEntry[]> {
    return parseDevices((await this.runner.run(['devices', '-l'], opts)).stdout)
  }

  async connect(ip: string, port: number, opts?: RunOptions): Promise<ConnectOutcome> {
    return parseConnect(combined(await this.runner.run(['connect', `${ip}:${port}`], { timeoutMs: 20_000, ...opts })))
  }

  async disconnect(target: string): Promise<void> {
    await this.runner.run(['disconnect', target], { timeoutMs: 10_000 })
  }

  async pair(ip: string, port: number, code: string, opts?: RunOptions): Promise<PairOutcome> {
    return parsePair(combined(await this.runner.run(['pair', `${ip}:${port}`, code], { timeoutMs: 30_000, ...opts })))
  }

  async mdnsServices(opts?: RunOptions): Promise<DiscoveredService[]> {
    try {
      return parseMdnsServices(combined(await this.runner.run(['mdns', 'services'], { timeoutMs: 10_000, ...opts })))
    } catch {
      return []
    }
  }

  /** Runs a command on the TV. Every argument is quoted for the TV's shell. */
  shell(serial: string, args: string[], opts?: RunOptions): Promise<AdbResult> {
    return this.runner.run(['-s', serial, 'shell', ...args.map(shQuote)], opts)
  }

  async info(serial: string, opts?: RunOptions): Promise<TvInfo> {
    const [props, df, wm] = await Promise.all([
      this.shell(serial, ['getprop'], opts).then((r) => parseGetprop(r.stdout)),
      this.shell(serial, ['df', '-k', '/data'], opts).then((r) => parseDf(r.stdout)),
      this.shell(serial, ['wm', 'density'], opts).then((r) => parseWmDensity(r.stdout))
    ])
    const abilist = props['ro.product.cpu.abilist'] || props['ro.product.cpu.abi'] || ''
    const sdk = Number(props['ro.build.version.sdk'])
    return {
      manufacturer: props['ro.product.manufacturer'] || undefined,
      model: props['ro.product.model'] || undefined,
      androidVersion: props['ro.build.version.release'] || undefined,
      sdk: Number.isFinite(sdk) && sdk > 0 ? sdk : undefined,
      abis: abilist.split(',').map((s) => s.trim()).filter(Boolean),
      density: wm ?? (Number(props['ro.sf.lcd_density']) || undefined),
      locale: props['persist.sys.locale'] || props['ro.product.locale'] || undefined,
      serialNo: props['ro.serialno'] || props['ro.boot.serialno'] || undefined,
      freeBytes: df?.freeBytes,
      totalBytes: df?.totalBytes
    }
  }
}

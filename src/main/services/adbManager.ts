import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AdbStatus } from '@shared/types'
import { AdbClient } from '../adb/client'
import { candidatePaths, findAdb } from '../adb/locate'
import { ExecRunner } from '../adb/runner'
import type { Log } from '../log'

/** `adb pair` arrived in platform-tools 30.0.0. */
const MIN_PAIRING_MAJOR = 30

/** Hides pairing codes from the Details log. */
export function redactArgs(args: string[]): string[] {
  const i = args.indexOf('pair')
  if (i >= 0 && args.length > i + 2) {
    const copy = [...args]
    copy[i + 2] = '******'
    return copy
  }
  return args
}

/** Locates adb and owns the AdbClient the rest of the app uses. */
export class AdbManager {
  private current?: AdbClient
  private status: AdbStatus = { found: false }

  constructor(
    private readonly dataDir: string,
    private readonly log: Log
  ) {}

  get platformToolsDir(): string {
    return join(this.dataDir, 'platform-tools')
  }

  client(): AdbClient | undefined {
    return this.current
  }

  getStatus(): AdbStatus {
    return { ...this.status }
  }

  async detect(): Promise<AdbStatus> {
    const found = await findAdb(candidatePaths(process.env, process.platform, this.platformToolsDir, homedir()))
    if (!found) {
      this.current = undefined
      this.status = { found: false }
      this.log.info('adb not found on PATH, in the Android SDK, or in the app’s data folder.')
      return this.getStatus()
    }
    const client = new AdbClient(new ExecRunner(found.path, this.log, redactArgs))
    try {
      const v = await client.version()
      if (!v.version && !v.protocol) throw new Error('`adb version` returned unexpected output.')
      this.current = client
      this.status = {
        found: true,
        path: found.path,
        source: found.source,
        version: v.version ?? v.protocol,
        supportsPairing: v.major === undefined ? true : v.major >= MIN_PAIRING_MAJOR
      }
      this.log.info(`Using adb ${this.status.version} from ${found.path}`)
    } catch (e) {
      this.current = undefined
      this.status = { found: false, path: found.path, source: found.source, error: (e as Error).message }
    }
    return this.getStatus()
  }

  /** Stop the adb server on quit, but only if it is our own copy (don't disturb a user's adb). */
  async shutdown(): Promise<void> {
    if (this.current && this.status.source === 'app-data') {
      await this.current.runner.run(['kill-server'], { timeoutMs: 5000 }).catch(() => undefined)
    }
  }
}

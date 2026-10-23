import { spawn } from 'node:child_process'
import type { Log } from '../log'

export interface AdbResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface RunOptions {
  signal?: AbortSignal
  /** Kill adb after this many ms. Default 30s. 0 disables the timeout. */
  timeoutMs?: number
  /** Called with stdout/stderr chunks as they arrive. */
  onOutput?: (chunk: string) => void
  /** Don't write this command to the Details log (background status polling). */
  quiet?: boolean
}

/**
 * The only way the app talks to adb. Production uses ExecRunner; tests use a
 * fake that replays recorded fixtures.
 */
export interface AdbRunner {
  run(args: string[], opts?: RunOptions): Promise<AdbResult>
}

export class AdbCancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'AdbCancelledError'
  }
}

export class AdbTimeoutError extends Error {
  constructor(seconds: number) {
    super(`adb didn’t answer within ${seconds} seconds.`)
    this.name = 'AdbTimeoutError'
  }
}

/** Format argv for the log only. Never executed. */
export function formatCommand(args: string[]): string {
  return ['adb', ...args].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)).join(' ')
}

/**
 * Runs the adb binary with an argument array (no shell, so file paths and user
 * input are never interpreted by a command interpreter on this computer).
 */
export class ExecRunner implements AdbRunner {
  constructor(
    readonly adbPath: string,
    private readonly log: Log,
    /** Arguments whose values should be masked in the log (e.g. pairing codes). */
    private readonly redact: (args: string[]) => string[] = (a) => a
  ) {}

  run(args: string[], opts: RunOptions = {}): Promise<AdbResult> {
    const timeoutMs = opts.timeoutMs ?? 30_000
    const log = opts.quiet ? undefined : this.log
    log?.add('cmd', formatCommand(this.redact(args)))
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new AdbCancelledError())
      const child = spawn(this.adbPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer: NodeJS.Timeout | undefined

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = (): void => {
        child.kill()
        log?.info('Cancelled.')
        finish(() => reject(new AdbCancelledError()))
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill()
          log?.add('err', `Timed out after ${Math.round(timeoutMs / 1000)}s`)
          finish(() => reject(new AdbTimeoutError(Math.round(timeoutMs / 1000))))
        }, timeoutMs)
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d: string) => {
        stdout += d
        opts.onOutput?.(d)
      })
      child.stderr.on('data', (d: string) => {
        stderr += d
        opts.onOutput?.(d)
      })
      child.on('error', (err) => {
        log?.add('err', `Could not start adb: ${err.message}`)
        finish(() => reject(err))
      })
      child.on('close', (code) => {
        const out = stdout.trim()
        const err = stderr.trim()
        if (out) log?.add('out', out)
        if (err) log?.add('err', err)
        finish(() => resolve({ stdout, stderr, code }))
      })
    })
  }
}

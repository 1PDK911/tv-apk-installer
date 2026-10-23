import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdbResult, AdbRunner, RunOptions } from '../src/main/adb/runner'

export const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')
export const adbFixture = (name: string): string => fixture(join('adb', name))

type Responder = string | AdbResult | ((args: string[]) => string | AdbResult)

/**
 * Replays canned adb output. Rules are matched in order against the joined
 * argv; the first rule whose pattern matches wins. Every call is recorded.
 */
export class FakeRunner implements AdbRunner {
  calls: string[][] = []
  private rules: Array<{ pattern: RegExp | string; respond: Responder; once: boolean; used: boolean }> = []

  on(pattern: RegExp | string, respond: Responder, opts: { once?: boolean } = {}): this {
    this.rules.push({ pattern, respond, once: !!opts.once, used: false })
    return this
  }

  async run(args: string[], opts?: RunOptions): Promise<AdbResult> {
    if (opts?.signal?.aborted) throw new Error('Cancelled')
    this.calls.push(args)
    const joined = args.join(' ')
    const rule = this.rules.find(
      (r) => !(r.once && r.used) && (typeof r.pattern === 'string' ? joined === r.pattern : r.pattern.test(joined))
    )
    if (!rule) return { stdout: '', stderr: `FakeRunner: no rule for "${joined}"`, code: 1 }
    rule.used = true
    const out = typeof rule.respond === 'function' ? rule.respond(args) : rule.respond
    return typeof out === 'string' ? { stdout: out, stderr: '', code: 0 } : out
  }

  ran(pattern: RegExp): boolean {
    return this.calls.some((c) => pattern.test(c.join(' ')))
  }
}

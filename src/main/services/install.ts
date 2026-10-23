import type { InstallOptions, InstallResult, LaunchResult } from '@shared/types'
import { isValidPackageName } from '@shared/validation'
import type { AdbClient } from '../adb/client'
import { type ErrorContext, isInstallSuccess, mapInstallError } from '../adb/errors'
import { parsePackageDump, parseResolveActivity } from '../adb/parse'
import { AdbCancelledError } from '../adb/runner'
import type { Log } from '../log'

export interface ObbFile {
  local: string
  /** File name only; it is pushed to /sdcard/Android/obb/<package>/<name>. */
  name: string
}

/** Everything needed to install one queue item. Built by inspect.ts / bundles.ts. */
export interface InstallPlan {
  packageName: string
  versionName?: string
  versionCode?: number
  apks: string[]
  obbs: ObbFile[]
  totalBytes: number
  ctx: ErrorContext
}

export type StepReporter = (steps: string[], index: number, detail?: string) => void

const LEANBACK = 'android.intent.category.LEANBACK_LAUNCHER'
const LAUNCHER = 'android.intent.category.LAUNCHER'

/** Generous timeout: 2 minutes plus 1 minute per 50 MB (slow Wi-Fi). */
export const installTimeoutMs = (bytes: number): number => 120_000 + Math.ceil(bytes / (50 * 1024 * 1024)) * 60_000

export function installArgs(serial: string, plan: InstallPlan, opts: InstallOptions): string[] {
  const flags = ['-r']
  if (opts.allowTest) flags.push('-t')
  if (opts.bypassLowTargetSdk) flags.push('--bypass-low-target-sdk-block')
  return plan.apks.length > 1
    ? ['-s', serial, 'install-multiple', ...flags, ...plan.apks]
    : ['-s', serial, 'install', ...flags, plan.apks[0]]
}

export class Installer {
  constructor(
    private readonly adb: AdbClient,
    private readonly log: Log
  ) {}

  async installedPackage(serial: string, pkg: string, signal?: AbortSignal) {
    if (!isValidPackageName(pkg)) return undefined
    const r = await this.adb.shell(serial, ['dumpsys', 'package', pkg], { signal, timeoutMs: 20_000 })
    return parsePackageDump(r.stdout, pkg)
  }

  async uninstall(serial: string, pkg: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
    if (!isValidPackageName(pkg)) return { ok: false, output: 'Invalid package name' }
    const r = await this.adb.runner.run(['-s', serial, 'uninstall', pkg], { signal, timeoutMs: 60_000 })
    const output = `${r.stdout}\n${r.stderr}`.trim()
    return { ok: /^Success/m.test(output), output }
  }

  async install(
    serial: string,
    plan: InstallPlan,
    opts: InstallOptions,
    report: StepReporter,
    signal?: AbortSignal
  ): Promise<InstallResult> {
    const steps = [
      ...(opts.uninstallFirst ? ['Removing installed version'] : []),
      plan.apks.length > 1 ? `Sending ${plan.apks.length} APKs & installing` : 'Sending to TV & installing',
      ...(plan.obbs.length ? ['Copying game data (OBB)'] : []),
      'Verifying'
    ]
    let step = 0
    const next = (detail?: string): void => report(steps, step++, detail)

    try {
      if (opts.uninstallFirst) {
        next(plan.packageName)
        const u = await this.uninstall(serial, plan.packageName, signal)
        if (!u.ok && !/DELETE_FAILED_INTERNAL_ERROR|Unknown package|not installed/i.test(u.output)) {
          return {
            ok: false,
            message: 'Couldn’t remove the installed version.',
            failure: mapInstallError(u.output, plan.ctx)
          }
        }
      }

      next()
      const r = await this.adb.runner.run(installArgs(serial, plan, opts), {
        signal,
        timeoutMs: installTimeoutMs(plan.totalBytes)
      })
      const output = `${r.stdout}\n${r.stderr}`
      if (!isInstallSuccess(output)) {
        const failure = mapInstallError(output, plan.ctx)
        return { ok: false, message: failure.title, failure, packageName: plan.packageName }
      }

      if (plan.obbs.length) {
        next()
        const dir = `/sdcard/Android/obb/${plan.packageName}`
        await this.adb.shell(serial, ['mkdir', '-p', dir], { signal })
        for (const [i, obb] of plan.obbs.entries()) {
          report(steps, step - 1, `${i + 1} of ${plan.obbs.length}: ${obb.name}`)
          const p = await this.adb.runner.run(['-s', serial, 'push', obb.local, `${dir}/${obb.name}`], {
            signal,
            timeoutMs: installTimeoutMs(plan.totalBytes)
          })
          const out = `${p.stdout}\n${p.stderr}`
          if (/error|failed|denied/i.test(out) && !/\d+ files? pushed/i.test(out)) {
            return {
              ok: false,
              packageName: plan.packageName,
              message: 'The app installed, but copying its game data failed.',
              failure: {
                code: 'OBB_PUSH_FAILED',
                title: 'Couldn’t copy the game data (OBB) to the TV',
                explanation: 'The app is installed but may not start without its data files.',
                fix: 'Check free storage on the TV and try installing again.',
                raw: out.trim()
              }
            }
          }
        }
      }

      next()
      const installed = await this.installedPackage(serial, plan.packageName, signal).catch(() => undefined)
      const versionName = installed?.versionName ?? plan.versionName
      return {
        ok: true,
        packageName: plan.packageName,
        versionName,
        message: `Installed${versionName ? ` version ${versionName}` : ''}.`
      }
    } catch (e) {
      if (e instanceof AdbCancelledError || signal?.aborted) {
        this.log.info('Install cancelled. The TV discards a partial install automatically.')
        return { ok: false, cancelled: true, message: 'Cancelled.' }
      }
      const failure = mapInstallError((e as Error).message, plan.ctx)
      return { ok: false, message: failure.title, failure }
    }
  }

  /** Opens the app on the TV: LEANBACK_LAUNCHER activity first, then LAUNCHER. */
  async launch(serial: string, pkg: string): Promise<LaunchResult> {
    if (!isValidPackageName(pkg)) return { ok: false, message: 'Invalid package name.' }
    for (const category of [LEANBACK, LAUNCHER]) {
      const r = await this.adb.shell(serial, [
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        category,
        pkg
      ])
      const component = parseResolveActivity(r.stdout)
      if (!component) continue
      const s = await this.adb.shell(serial, ['am', 'start', '-a', 'android.intent.action.MAIN', '-c', category, '-n', component])
      const out = `${s.stdout}\n${s.stderr}`
      if (/Error|Exception/i.test(out)) return { ok: false, message: `The TV couldn’t open the app: ${out.trim().split('\n').pop()}` }
      return {
        ok: true,
        message: category === LEANBACK ? 'Opened on the TV.' : 'Opened on the TV (phone-style app — the remote may not work everywhere).'
      }
    }
    // Older Android without `cmd package resolve-activity`: let monkey pick the launcher activity.
    for (const category of [LEANBACK, LAUNCHER]) {
      const m = await this.adb.shell(serial, ['monkey', '-p', pkg, '-c', category, '1'])
      if (/Events injected: 1/.test(`${m.stdout}\n${m.stderr}`)) return { ok: true, message: 'Opened on the TV.' }
    }
    return {
      ok: false,
      message: 'This app has no launcher screen, so it can’t be opened directly (it may be a service, keyboard or plugin).'
    }
  }

  async forceStop(serial: string, pkg: string): Promise<void> {
    if (!isValidPackageName(pkg)) throw new Error('Invalid package name')
    await this.adb.shell(serial, ['am', 'force-stop', pkg])
  }
}

import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import type { TvApp } from '@shared/types'
import { isValidPackageName } from '@shared/validation'
import type { AdbClient } from '../adb/client'
import { parseAllPackages, parsePmList, parsePmPath } from '../adb/parse'
import { writeStoredZip } from '../zipWriter'

const INSTALLERS: Record<string, string> = {
  'com.android.vending': 'Play Store',
  'com.google.android.packageinstaller': 'Sideloaded',
  'com.android.packageinstaller': 'Sideloaded',
  'com.android.shell': 'Sideloaded (adb)'
}

export function describeInstaller(installer: string | undefined): string {
  if (!installer) return 'Sideloaded'
  return INSTALLERS[installer] ?? installer
}

/** Lists, opens, stops, uninstalls and backs up user-installed apps. */
export class AppManager {
  constructor(private readonly adb: AdbClient) {}

  async list(serial: string, signal?: AbortSignal): Promise<TvApp[]> {
    const [all, disabled, dump] = await Promise.all([
      this.adb.shell(serial, ['pm', 'list', 'packages', '-3', '--show-versioncode'], { signal, timeoutMs: 30_000 }),
      this.adb.shell(serial, ['pm', 'list', 'packages', '-3', '-d'], { signal, timeoutMs: 30_000 }),
      this.adb.shell(serial, ['dumpsys', 'package', 'packages'], { signal, timeoutMs: 60_000 })
    ])
    const disabledSet = new Set(parsePmList(disabled.stdout).map((p) => p.packageName))
    const details = parseAllPackages(dump.stdout)
    return parsePmList(all.stdout)
      .map(({ packageName, versionCode }) => {
        const d = details.get(packageName)
        return {
          packageName,
          versionName: d?.versionName,
          versionCode: d?.versionCode ?? versionCode,
          source: describeInstaller(d?.installer),
          enabled: !disabledSet.has(packageName),
          lastUpdateTime: d?.lastUpdateTime
        }
      })
      .sort((a, b) => a.packageName.localeCompare(b.packageName))
  }

  async apkPaths(serial: string, pkg: string, signal?: AbortSignal): Promise<string[]> {
    if (!isValidPackageName(pkg)) throw new Error('Invalid package name')
    const r = await this.adb.shell(serial, ['pm', 'path', pkg], { signal })
    return parsePmPath(r.stdout)
  }

  /**
   * Copies an app's APK(s) from the TV. One APK is saved as-is; split apps
   * are packed into an .apks file that this app (and SAI) can reinstall.
   */
  async saveCopy(
    serial: string,
    pkg: string,
    dest: string,
    workDir: string,
    onProgress: (done: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<{ files: number; path: string }> {
    const remote = await this.apkPaths(serial, pkg, signal)
    if (!remote.length) throw new Error('The TV didn’t report any APK files for this app.')
    const tmp = join(workDir, randomUUID())
    await mkdir(tmp, { recursive: true })
    try {
      const local: Array<{ name: string; path: string }> = []
      for (const [i, r] of remote.entries()) {
        onProgress(i, remote.length)
        const name = basename(r)
        const target = remote.length === 1 ? dest : join(tmp, `${i}-${name}`)
        const res = await this.adb.runner.run(['-s', serial, 'pull', r, target], { signal, timeoutMs: 0 })
        const out = `${res.stdout}\n${res.stderr}`
        if (!/\d+ files? pulled/i.test(out)) throw new Error(`Couldn’t copy ${name}: ${out.trim().split('\n').pop()}`)
        local.push({ name: i === 0 ? 'base.apk' : name, path: target })
      }
      onProgress(remote.length, remote.length)
      if (remote.length > 1) await writeStoredZip(dest, local, signal)
      return { files: remote.length, path: dest }
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
}

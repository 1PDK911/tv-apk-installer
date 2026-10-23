// Pre-flight checks: compares an app with the connected TV before installing.
// Pure function; tested in test/preflight.test.ts.

import { androidName, minInstallableTargetSdk } from '@shared/android'
import type { ApkInfo, InstalledState, PreflightCheck, TvInfo } from '@shared/types'
import { formatBytesPlain } from './format'

/** Space needed: the APKs are copied, then optimized; plan for twice their size plus OBB data. */
export function requiredBytes(info: ApkInfo): number {
  const apkBytes = info.bundle
    ? info.bundle.splits.filter((s) => s.selected).reduce((n, s) => n + s.sizeBytes, 0)
    : info.sizeBytes
  const obbBytes = info.bundle?.obbs.reduce((n, o) => n + o.sizeBytes, 0) ?? 0
  return apkBytes * 2 + obbBytes
}

/** True if any of the app's ABIs can run on the TV (TV ABI lists include compatible 32-bit ABIs). */
export function abiCompatible(appAbis: string[], tvAbis: string[]): boolean {
  if (!appAbis.length || !tvAbis.length) return true
  return appAbis.some((a) => tvAbis.includes(a))
}

export function preflight(info: ApkInfo, tv: TvInfo | undefined, installed?: InstalledState): PreflightCheck[] {
  const checks: PreflightCheck[] = []

  if (tv?.sdk && info.minSdk && info.minSdk > tv.sdk) {
    checks.push({
      id: 'api',
      level: 'block',
      title: `Needs ${androidName(info.minSdk)} — your TV has ${androidName(tv.sdk)}`,
      detail: 'Android will refuse to install it. Look for an older release of the app.'
    })
  }

  const appAbis = info.bundle ? info.bundle.splits.filter((s) => s.type === 'abi').map((s) => s.value!).filter(Boolean) : info.abis
  const allAbis = [...new Set([...info.abis, ...appAbis])]
  if (tv?.abis.length && !abiCompatible(allAbis, tv.abis)) {
    checks.push({
      id: 'abi',
      level: 'block',
      title: 'Built for a different processor',
      detail: `The app has code for ${allAbis.join(', ')}; your TV supports ${tv.abis.join(', ')}. Get the build for your TV’s processor.`
    })
  }

  if (tv?.freeBytes !== undefined) {
    const need = requiredBytes(info)
    if (need > tv.freeBytes) {
      const half = need / 2
      checks.push({
        id: 'storage',
        level: half > tv.freeBytes ? 'block' : 'warn',
        title: `Low storage: ${formatBytesPlain(tv.freeBytes)} free`,
        detail: `Installing needs about ${formatBytesPlain(need)}. Uninstall unused apps first (Apps on TV tab).`
      })
    }
  }

  const minTarget = minInstallableTargetSdk(tv?.sdk)
  if (minTarget && info.targetSdk && info.targetSdk < minTarget) {
    checks.push({
      id: 'target',
      level: 'warn',
      title: `Built for an old Android version (targets ${androidName(info.targetSdk)})`,
      detail: `Your TV’s Android version blocks apps that target below API ${minTarget}. The install will fail unless you choose to bypass the block.`
    })
  }

  if (installed?.installed) {
    const have = installed.versionCode
    const next = info.versionCode
    const from = installed.versionName ?? (have !== undefined ? `code ${have}` : 'unknown')
    const to = info.versionName ?? (next !== undefined ? `code ${next}` : 'unknown')
    if (have !== undefined && next !== undefined && next < have) {
      checks.push({
        id: 'downgrade',
        level: 'warn',
        title: `Downgrade: v${from} is installed, this is v${to}`,
        detail: 'Android won’t install an older version over a newer one. You’ll be offered to uninstall first, which deletes the app’s data.'
      })
    } else if (have !== undefined && next !== undefined && next === have) {
      checks.push({ id: 'installed', level: 'info', title: `Already installed (v${from}) — will reinstall the same version` })
    } else {
      checks.push({ id: 'installed', level: 'info', title: `Update: v${from} → v${to}` })
    }
  }

  if (!info.tv.leanbackLauncher) {
    checks.push({
      id: 'phone',
      level: 'warn',
      title: 'Phone app — not made for TV',
      detail:
        (info.tv.touchscreenRequired ? 'It requires a touchscreen. ' : '') +
        'It won’t appear on the TV home screen (open it with “Open on TV” or from Settings → Apps), and parts of it may not work with the remote.'
    })
  } else if (info.tv.touchscreenRequired) {
    checks.push({
      id: 'phone',
      level: 'info',
      title: 'Declares a touchscreen requirement',
      detail: 'Some screens may need a touchscreen or mouse.'
    })
  }

  if (info.testOnly) {
    checks.push({
      id: 'test',
      level: 'info',
      title: 'Test build',
      detail: 'Android needs explicit permission to install it; you’ll be offered a retry for test builds if needed.'
    })
  }

  return checks
}

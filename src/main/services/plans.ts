import type { ApkInfo, TvInfo } from '@shared/types'
import type { ErrorContext } from '../adb/errors'
import { rm } from 'node:fs/promises'
import { bundleInfo, extractBundle, selectSplits } from '../apk/bundle'
import { inspectApk, readApk, sha256File, tvSuitability } from '../apk/inspect'
import { ZipReader } from '../zip'
import type { RegisteredFile } from './files'
import type { InstallPlan } from './install'

export function errorContext(
  tv: TvInfo | undefined,
  apk: { minSdk?: number; targetSdk?: number; abis?: string[]; size?: number }
): ErrorContext {
  return {
    tvSdk: tv?.sdk,
    tvAbis: tv?.abis,
    freeBytes: tv?.freeBytes,
    apkMinSdk: apk.minSdk,
    apkTargetSdk: apk.targetSdk,
    apkAbis: apk.abis,
    apkSize: apk.size
  }
}

/** Builds the install plan for a single .apk file. */
export async function planForApk(file: RegisteredFile, tv: TvInfo | undefined): Promise<InstallPlan> {
  const zip = await ZipReader.open(file.path)
  try {
    const { manifest, abis } = await readApk(zip)
    return {
      packageName: manifest.packageName,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      apks: [file.path],
      obbs: [],
      totalBytes: file.size,
      ctx: errorContext(tv, { minSdk: manifest.minSdk, targetSdk: manifest.targetSdk, abis, size: file.size })
    }
  } finally {
    zip.close()
  }
}

export interface PlanResult {
  plan: InstallPlan
  cleanup: () => Promise<void>
}

export async function buildPlan(
  file: RegisteredFile,
  tv: TvInfo | undefined,
  workDir: string,
  signal?: AbortSignal
): Promise<PlanResult> {
  if (file.kind === 'apk') return { plan: await planForApk(file, tv), cleanup: async () => undefined }
  const b = await extractBundle(file.path, file.kind, workDir, { withObbs: true, locale: tv?.locale, signal })
  const cleanup = (): Promise<void> => rm(b.dir, { recursive: true, force: true })
  try {
    selectSplits(b.splits, tv)
    const chosen = b.splits.filter((s) => s.selected)
    // Base first, as Android expects.
    chosen.sort((a, x) => Number(x.type === 'base') - Number(a.type === 'base'))
    const m = b.base.manifest
    const abis = b.splits.filter((s) => s.type === 'abi').map((s) => s.value!)
    const totalBytes = chosen.reduce((n, s) => n + s.sizeBytes, 0) + b.obbs.reduce((n, o) => n + o.sizeBytes, 0)
    return {
      plan: {
        packageName: m.packageName,
        versionName: m.versionName,
        versionCode: m.versionCode,
        apks: chosen.map((s) => s.path),
        obbs: b.obbs.map((o) => ({ local: o.path, name: o.name })),
        totalBytes,
        ctx: errorContext(tv, { minSdk: m.minSdk, targetSdk: m.targetSdk, abis: abis.length ? abis : b.base.abis, size: totalBytes })
      },
      cleanup
    }
  } catch (e) {
    await cleanup()
    throw e
  }
}

/** Reads the info card for any supported file. */
export async function inspectFile(
  file: RegisteredFile,
  tv: TvInfo | undefined,
  workDir: string,
  signal?: AbortSignal
): Promise<ApkInfo> {
  if (file.kind === 'apk') return inspectApk(file, signal, tv?.locale)
  const b = await extractBundle(file.path, file.kind, workDir, { withObbs: false, locale: tv?.locale, signal })
  try {
    const m = b.base.manifest
    return {
      fileId: file.id,
      fileName: file.name,
      kind: file.kind,
      packageName: m.packageName,
      label: b.base.label,
      versionName: m.versionName,
      versionCode: m.versionCode,
      minSdk: m.minSdk,
      targetSdk: m.targetSdk,
      icon: b.base.icon ?? b.icon,
      abis: b.base.abis,
      sizeBytes: file.size,
      sha256: await sha256File(file.path, signal),
      tv: tvSuitability(m),
      testOnly: m.testOnly,
      debuggable: m.debuggable,
      bundle: bundleInfo(b, tv)
    }
  } finally {
    await rm(b.dir, { recursive: true, force: true })
  }
}

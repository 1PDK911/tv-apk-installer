import type { TvInfo } from '@shared/types'
import type { ErrorContext } from '../adb/errors'
import { readApk } from '../apk/inspect'
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

export async function buildPlan(file: RegisteredFile, tv: TvInfo | undefined): Promise<PlanResult> {
  if (file.kind === 'apk') return { plan: await planForApk(file, tv), cleanup: async () => undefined }
  throw new Error('Bundles (.apks, .xapk, .apkm) aren’t supported yet.')
}

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { ApkInfo, FileKind, TvSuitability } from '@shared/types'
import { ZipReader } from '../zip'
import { type ManifestInfo, parseManifest } from './manifest'

export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** ABIs with native libraries, from lib/<abi>/*.so entries. */
export function nativeAbis(entryNames: Iterable<string>): string[] {
  const abis = new Set<string>()
  for (const n of entryNames) {
    const m = /^lib\/([^/]+)\/[^/]+\.so$/.exec(n)
    if (m) abis.add(m[1])
  }
  return [...abis].sort()
}

export function tvSuitability(m: ManifestInfo): TvSuitability {
  const leanback = m.usesFeatures.find((f) => f.name === 'android.software.leanback')
  return {
    leanbackLauncher: m.hasLeanbackLauncher,
    leanbackFeature: leanback ? (leanback.required ? 'required' : 'optional') : 'absent',
    touchscreenRequired: m.usesFeatures.some((f) => f.name === 'android.hardware.touchscreen' && f.required),
    hasBanner: m.bannerRef !== undefined
  }
}

export interface ApkDetails {
  manifest: ManifestInfo
  abis: string[]
  label?: string
  icon?: string
}

/** Reads manifest, ABIs, label and icon from an open APK zip. */
export async function readApk(zip: ZipReader): Promise<ApkDetails> {
  if (!zip.has('AndroidManifest.xml')) throw new Error('This file has no AndroidManifest.xml, so it isn’t an APK.')
  const manifest = parseManifest(await zip.read('AndroidManifest.xml', 8 * 1024 * 1024))
  const label = typeof manifest.label === 'string' ? manifest.label : undefined
  return { manifest, abis: nativeAbis(zip.entries.keys()), label }
}

export async function inspectApk(
  file: { id: string; name: string; path: string; size: number; kind: FileKind },
  signal?: AbortSignal
): Promise<ApkInfo> {
  const zip = await ZipReader.open(file.path).catch(() => {
    throw new Error('This file isn’t a valid APK (it can’t be opened as a zip archive). It may be damaged or incomplete.')
  })
  try {
    const d = await readApk(zip)
    return {
      fileId: file.id,
      fileName: file.name,
      kind: file.kind,
      packageName: d.manifest.packageName,
      label: d.label,
      versionName: d.manifest.versionName,
      versionCode: d.manifest.versionCode,
      minSdk: d.manifest.minSdk,
      targetSdk: d.manifest.targetSdk,
      icon: d.icon,
      abis: d.abis,
      sizeBytes: file.size,
      sha256: await sha256File(file.path, signal),
      tv: tvSuitability(d.manifest),
      testOnly: d.manifest.testOnly,
      debuggable: d.manifest.debuggable
    }
  } finally {
    zip.close()
  }
}

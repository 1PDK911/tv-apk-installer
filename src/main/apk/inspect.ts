import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { ApkInfo, FileKind, TvSuitability } from '@shared/types'
import { ZipReader } from '../zip'
import { ResourceTable } from './arsc'
import { findAll, parseAxml } from './axml'
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

const MIME: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
const MAX_ICON_BYTES = 1024 * 1024

/** Finds a raster launcher icon, following adaptive-icon XML to its foreground layer if needed. */
async function readIcon(zip: ZipReader, table: ResourceTable, iconRef: number): Promise<string | undefined> {
  const tryFiles = async (paths: string[]): Promise<string | undefined> => {
    for (const p of paths) {
      const ext = /\.(png|webp|jpe?g)$/i.exec(p)?.[1]?.toLowerCase()
      const entry = zip.entries.get(p)
      if (!ext || !entry || entry.uncompressedSize > MAX_ICON_BYTES) continue
      try {
        return `data:${MIME[ext]};base64,${(await zip.read(p, MAX_ICON_BYTES)).toString('base64')}`
      } catch {
        // try the next candidate
      }
    }
    return undefined
  }
  const files = table.resolveFiles(iconRef)
  const raster = await tryFiles(files)
  if (raster) return raster
  for (const xml of files.filter((f) => f.endsWith('.xml') && zip.has(f))) {
    try {
      const root = parseAxml(await zip.read(xml, 512 * 1024))
      for (const layer of ['foreground', 'background']) {
        const el = findAll(root, layer)[0]
        const v = el && el.attrs.find((a) => a.name === 'drawable' || a.resId === 0x01010199)?.value
        if (v && typeof v === 'object') {
          const found = await tryFiles(table.resolveFiles(v.ref))
          if (found) return found
        }
      }
    } catch {
      // not an adaptive icon we understand
    }
  }
  return undefined
}

/** Reads manifest, ABIs, label and icon from an open APK zip. */
export async function readApk(zip: ZipReader, locale?: string): Promise<ApkDetails> {
  if (!zip.has('AndroidManifest.xml')) throw new Error('This file has no AndroidManifest.xml, so it isn’t an APK.')
  const manifest = parseManifest(await zip.read('AndroidManifest.xml', 8 * 1024 * 1024))
  let label = typeof manifest.label === 'string' ? manifest.label : undefined
  let icon: string | undefined
  if (zip.has('resources.arsc') && (typeof manifest.label === 'object' || manifest.iconRef !== undefined)) {
    try {
      const table = new ResourceTable(await zip.read('resources.arsc', 96 * 1024 * 1024))
      if (manifest.label && typeof manifest.label === 'object') label = table.resolveString(manifest.label.ref, locale)
      if (manifest.iconRef !== undefined) icon = await readIcon(zip, table, manifest.iconRef)
    } catch {
      // Label and icon are cosmetic; never fail inspection because of them.
    }
  }
  return { manifest, abis: nativeAbis(zip.entries.keys()), label, icon }
}

export async function inspectApk(
  file: { id: string; name: string; path: string; size: number; kind: FileKind },
  signal?: AbortSignal,
  locale?: string
): Promise<ApkInfo> {
  const zip = await ZipReader.open(file.path).catch(() => {
    throw new Error('This file isn’t a valid APK (it can’t be opened as a zip archive). It may be damaged or incomplete.')
  })
  try {
    const d = await readApk(zip, locale)
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

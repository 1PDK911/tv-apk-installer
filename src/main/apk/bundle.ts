// Split-APK bundles: .apks (SAI or bundletool), .xapk (APKPure), .apkm
// (APKMirror). Extracts the APKs, classifies each split, and picks the ones
// that match the TV, the way Android's package installer would.

import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BundleInfo, FileKind, SplitInfo, TvInfo } from '@shared/types'
import { EncryptedEntryError, ZipReader } from '../zip'
import { type ApkDetails, readApk } from './inspect'

export const DENSITIES: Record<string, number> = {
  ldpi: 120,
  mdpi: 160,
  tvdpi: 213,
  hdpi: 240,
  xhdpi: 320,
  xxhdpi: 480,
  xxxhdpi: 640
}
const ABIS: Record<string, string> = {
  armeabi: 'armeabi',
  armeabi_v7a: 'armeabi-v7a',
  arm64_v8a: 'arm64-v8a',
  x86: 'x86',
  x86_64: 'x86_64',
  mips: 'mips',
  mips64: 'mips64',
  riscv64: 'riscv64'
}

export class BundleError extends Error {}

export interface BundleSplit extends SplitInfo {
  /** Extracted APK path. */
  path: string
  /** Module the split belongs to ("base" or a feature name). */
  module: string
}

export interface ExtractedBundle {
  dir: string
  base: ApkDetails
  basePath: string
  splits: BundleSplit[]
  obbs: { name: string; path: string; sizeBytes: number }[]
  /** Icon shipped next to the APKs (icon.png) when the base APK's icon can't be rendered. */
  icon?: string
}

/** Classifies a split by its manifest `split` attribute (e.g. "config.arm64_v8a", "feature.config.xhdpi"). */
export function classifySplit(split: string | undefined, isFeatureSplit: boolean): Pick<SplitInfo, 'type' | 'value'> & { module: string } {
  if (!split) return { type: 'base', module: 'base' }
  const m = /^(?:(.+)\.)?config\.(.+)$/.exec(split)
  if (!m) return { type: 'feature', value: split, module: split }
  const module = m[1] ?? 'base'
  const q = m[2]
  if (ABIS[q]) return { type: 'abi', value: ABIS[q], module }
  if (DENSITIES[q] || q === 'nodpi' || q === 'anydpi') return { type: 'density', value: q, module }
  if (/^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/.test(q)) return { type: 'language', value: q, module }
  return { type: isFeatureSplit ? 'feature' : 'other', value: q, module }
}

/** Android's density matching: the closest density at or above the TV's, else the highest below. */
export function pickDensity(available: string[], tvDpi: number | undefined): string | undefined {
  const known = available.filter((d) => DENSITIES[d])
  if (!known.length) return undefined
  const dpi = tvDpi ?? 320
  const above = known.filter((d) => DENSITIES[d] >= dpi).sort((a, b) => DENSITIES[a] - DENSITIES[b])
  if (above.length) return above[0]
  return known.sort((a, b) => DENSITIES[b] - DENSITIES[a])[0]
}

/** The TV's most-preferred ABI that the app ships; without TV info, prefer 64-bit ARM. */
export function pickAbi(available: string[], tvAbis: string[] | undefined): string | undefined {
  const order = tvAbis?.length ? tvAbis : ['arm64-v8a', 'armeabi-v7a', 'armeabi', 'x86_64', 'x86']
  return order.find((a) => available.includes(a))
}

/** Marks splits as selected for this TV and returns a short explanation. */
export function selectSplits<T extends SplitInfo & { module: string }>(splits: T[], tv: TvInfo | undefined): string {
  const notes: string[] = []
  const tvLang = tv?.locale?.split(/[-_]/)[0]?.toLowerCase()
  for (const module of new Set(splits.map((s) => s.module))) {
    const mine = splits.filter((s) => s.module === module)
    const abi = pickAbi(mine.filter((s) => s.type === 'abi').map((s) => s.value!), tv?.abis)
    const density = pickDensity(mine.filter((s) => s.type === 'density').map((s) => s.value!), tv?.density)
    const langs = mine.filter((s) => s.type === 'language')
    const wantLangs = new Set([tvLang, 'en'].filter(Boolean) as string[])
    for (const s of mine) {
      switch (s.type) {
        case 'abi':
          s.selected = s.value === abi
          break
        case 'density':
          s.selected = s.value === density || s.value === 'nodpi' || s.value === 'anydpi'
          break
        case 'language':
          s.selected = wantLangs.has(s.value!.split(/[-_]/)[0].toLowerCase())
          break
        default:
          s.selected = true
      }
    }
    if (module === 'base') {
      if (abi) notes.push(`processor: ${abi}`)
      if (density) notes.push(`screen: ${density}`)
      const chosen = langs.filter((s) => s.selected).map((s) => s.value)
      if (langs.length) notes.push(`languages: ${chosen.length ? chosen.join(', ') : 'default only'}`)
    }
  }
  if (splits.some((s) => s.type === 'abi') && !splits.some((s) => s.type === 'abi' && s.selected))
    notes.push('no processor split matches this TV')
  return notes.length ? `Chosen for ${tv ? 'this TV' : 'a typical TV (connect to refine)'}: ${notes.join(' · ')}` : ''
}

/** APK entries to consider inside a bundle container. */
export function apkEntries(names: string[]): string[] {
  const apks = names.filter((n) => /\.apk$/i.test(n) && !n.endsWith('/'))
  // bundletool: prefer splits/; ignore standalones/ (pre-Lollipop) unless that's all there is.
  const splitsDir = apks.filter((n) => n.startsWith('splits/'))
  if (splitsDir.length) return splitsDir
  const nonStandalone = apks.filter((n) => !n.startsWith('standalones/'))
  if (nonStandalone.length) return nonStandalone
  return apks.slice(0, 1)
}

/** OBB expansion files inside an .xapk (Android/obb/<pkg>/<file>.obb). */
export function obbEntries(names: string[]): string[] {
  return names.filter((n) => /\.obb$/i.test(n) && /^[\w.-]+\.obb$/i.test(basename(n)))
}

/**
 * Extracts and analyses a bundle into `workDir/<random>`. The caller owns the
 * returned directory and must delete it (see `cleanup`).
 */
export async function extractBundle(
  path: string,
  kind: FileKind,
  workDir: string,
  opts: { withObbs: boolean; locale?: string; signal?: AbortSignal }
): Promise<ExtractedBundle> {
  let zip: ZipReader
  try {
    zip = await ZipReader.open(path)
  } catch {
    throw new BundleError(`This .${kind} file can’t be opened. It may be damaged, incomplete, or not a bundle.`)
  }
  const dir = join(workDir, randomUUID())
  await mkdir(dir, { recursive: true })
  try {
    const entries = zip.list()
    const names = entries.filter((e) => !e.isDirectory).map((e) => e.name)
    const apkNames = apkEntries(names)
    if (!apkNames.length) throw new BundleError(`This .${kind} file doesn’t contain any APKs.`)
    if (entries.some((e) => e.encrypted && /\.apk$/i.test(e.name))) {
      throw new BundleError(
        kind === 'apkm'
          ? 'This .apkm file is encrypted. Older APKMirror bundles can only be opened by the APKMirror Installer app. Download the bundle again from APKMirror (newer downloads aren’t encrypted) or get a plain .apk.'
          : 'This bundle is encrypted and can’t be installed.'
      )
    }

    const extracted: Array<{ name: string; path: string; details: ApkDetails; size: number }> = []
    for (const [i, name] of apkNames.entries()) {
      const target = join(dir, `${String(i).padStart(3, '0')}.apk`)
      await zip.extractTo(name, target, opts.signal)
      const apk = await ZipReader.open(target)
      try {
        extracted.push({ name, path: target, details: await readApk(apk, opts.locale), size: zip.entries.get(name)!.uncompressedSize })
      } catch (e) {
        throw new BundleError(`${basename(name)} inside the bundle isn’t a valid APK: ${(e as Error).message}`)
      } finally {
        apk.close()
      }
    }

    const bases = extracted.filter((x) => !x.details.manifest.split)
    if (bases.length !== 1)
      throw new BundleError(bases.length ? 'This bundle contains more than one base APK.' : 'This bundle has no base APK.')
    const base = bases[0]
    const pkg = base.details.manifest.packageName
    const foreign = extracted.find((x) => x.details.manifest.packageName !== pkg)
    if (foreign) throw new BundleError(`The bundle mixes different apps (${pkg} and ${foreign.details.manifest.packageName}).`)

    const splits: BundleSplit[] = extracted.map((x) => {
      const c = classifySplit(x.details.manifest.split, x.details.manifest.isFeatureSplit)
      return { name: x.details.manifest.split ?? 'base', type: c.type, value: c.value, module: c.module, sizeBytes: x.size, selected: true, path: x.path }
    })

    const obbs: ExtractedBundle['obbs'] = []
    for (const name of obbEntries(names)) {
      const size = zip.entries.get(name)!.uncompressedSize
      const target = join(dir, 'obb', basename(name))
      if (opts.withObbs) await zip.extractTo(name, target, opts.signal)
      obbs.push({ name: basename(name), path: target, sizeBytes: size })
    }

    let icon: string | undefined
    if (!base.details.icon && zip.has('icon.png') && zip.entries.get('icon.png')!.uncompressedSize < 1024 * 1024) {
      icon = `data:image/png;base64,${(await zip.read('icon.png')).toString('base64')}`
    }
    return { dir, base: base.details, basePath: base.path, splits, obbs, icon }
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    if (e instanceof EncryptedEntryError) throw new BundleError('This bundle is encrypted and can’t be installed.')
    throw e
  } finally {
    zip.close()
  }
}

export function bundleInfo(b: ExtractedBundle, tv: TvInfo | undefined): BundleInfo {
  const splits = b.splits.map((s) => ({ ...s }))
  const selectionNote = selectSplits(splits, tv)
  return {
    splits: splits.map(({ name, type, value, sizeBytes, selected }) => ({ name, type, value, sizeBytes, selected })),
    obbs: b.obbs.map(({ name, sizeBytes }) => ({ name, sizeBytes })),
    selectionNote
  }
}

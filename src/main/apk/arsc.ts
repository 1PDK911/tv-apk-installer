// Minimal resources.arsc reader: enough to resolve an app's label and icon
// references to concrete values for each configuration. Format reference:
// frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h

import { RES_STRING_POOL_TYPE, TYPE_REFERENCE, TYPE_STRING, readStringPool } from './axml'

const RES_TABLE_TYPE = 0x0002
const RES_TABLE_PACKAGE_TYPE = 0x0200
const RES_TABLE_TYPE_TYPE = 0x0201

const FLAG_SPARSE = 0x01
const FLAG_OFFSET16 = 0x02
const ENTRY_FLAG_COMPLEX = 0x0001
const ENTRY_FLAG_COMPACT = 0x0008
const NO_ENTRY = 0xffffffff

export interface ResConfig {
  /** Two-letter language, or "" for the default. */
  language: string
  country: string
  /** dpi; 0 = default, 0xfffe = anydpi, 0xffff = nodpi. */
  density: number
  sdk: number
}

export type ResValue = { type: 'string'; value: string } | { type: 'ref'; value: number } | { type: 'other'; dataType: number; value: number }

export interface ResEntry {
  config: ResConfig
  value: ResValue
}

export const DENSITY_ANY = 0xfffe
export const DENSITY_NONE = 0xffff

function readLocaleCode(buf: Buffer, at: number): string {
  const a = buf[at]
  const b = buf[at + 1]
  if (a === 0) return ''
  if (a & 0x80) {
    // Packed 3-letter code; rare. Unpack per ResTable_config::unpackLanguage.
    const first = b & 0x1f
    const second = ((b & 0xe0) >> 5) | ((a & 0x03) << 3)
    const third = (a & 0x7c) >> 2
    return String.fromCharCode(first + 0x61, second + 0x61, third + 0x61)
  }
  return String.fromCharCode(a, b)
}

function readConfig(buf: Buffer, at: number): ResConfig {
  const size = buf.readUInt32LE(at)
  return {
    language: size >= 12 ? readLocaleCode(buf, at + 8) : '',
    country: size >= 12 ? readLocaleCode(buf, at + 10) : '',
    density: size >= 16 ? buf.readUInt16LE(at + 14) : 0,
    sdk: size >= 28 ? buf.readUInt16LE(at + 24) : 0
  }
}

/** Parsed resource table; values are looked up lazily by resource id. */
export class ResourceTable {
  /** resId -> entries across configurations */
  private entries = new Map<number, ResEntry[]>()

  constructor(buf: Buffer) {
    if (buf.length < 12 || buf.readUInt16LE(0) !== RES_TABLE_TYPE) throw new Error('Not a resources.arsc file')
    let globalPool: string[] = []
    let off = buf.readUInt16LE(2)
    while (off + 8 <= buf.length) {
      const type = buf.readUInt16LE(off)
      const size = buf.readUInt32LE(off + 4)
      if (size < 8) break
      if (type === RES_STRING_POOL_TYPE) globalPool = readStringPool(buf, off)
      else if (type === RES_TABLE_PACKAGE_TYPE) this.readPackage(buf, off, globalPool)
      off += size
    }
  }

  private readPackage(buf: Buffer, pkgOff: number, pool: string[]): void {
    const headerSize = buf.readUInt16LE(pkgOff + 2)
    const pkgSize = buf.readUInt32LE(pkgOff + 4)
    const pkgId = buf.readUInt32LE(pkgOff + 8)
    let off = pkgOff + headerSize
    const end = pkgOff + pkgSize
    while (off + 8 <= end) {
      const type = buf.readUInt16LE(off)
      const size = buf.readUInt32LE(off + 4)
      if (size < 8 || off + size > end) break
      if (type === RES_TABLE_TYPE_TYPE) this.readType(buf, off, pkgId, pool)
      off += size
    }
  }

  private readType(buf: Buffer, off: number, pkgId: number, pool: string[]): void {
    const headerSize = buf.readUInt16LE(off + 2)
    const typeId = buf[off + 8]
    const flags = buf[off + 9]
    const entryCount = buf.readUInt32LE(off + 12)
    const entriesStart = buf.readUInt32LE(off + 16)
    const config = readConfig(buf, off + 20)
    const offsetsAt = off + headerSize

    const visit = (index: number, entryOffset: number): void => {
      const e = off + entriesStart + entryOffset
      if (e + 8 > buf.length) return
      const sizeOrKey = buf.readUInt16LE(e)
      const eflags = buf.readUInt16LE(e + 2)
      let value: ResValue | undefined
      if (eflags & ENTRY_FLAG_COMPACT) {
        const dataType = eflags >> 8
        const data = buf.readUInt32LE(e + 4)
        value = toValue(dataType, data, pool)
      } else if (!(eflags & ENTRY_FLAG_COMPLEX)) {
        const v = e + sizeOrKey
        const dataType = buf[v + 3]
        const data = buf.readUInt32LE(v + 4)
        value = toValue(dataType, data, pool)
      }
      if (!value) return
      const resId = ((pkgId & 0xff) << 24) | ((typeId & 0xff) << 16) | (index & 0xffff)
      const list = this.entries.get(resId >>> 0) ?? []
      list.push({ config, value })
      this.entries.set(resId >>> 0, list)
    }

    if (flags & FLAG_SPARSE) {
      for (let i = 0; i < entryCount; i++) {
        const p = offsetsAt + i * 4
        visit(buf.readUInt16LE(p), buf.readUInt16LE(p + 2) * 4)
      }
    } else if (flags & FLAG_OFFSET16) {
      for (let i = 0; i < entryCount; i++) {
        const o = buf.readUInt16LE(offsetsAt + i * 2)
        if (o !== 0xffff) visit(i, o * 4)
      }
    } else {
      for (let i = 0; i < entryCount; i++) {
        const o = buf.readUInt32LE(offsetsAt + i * 4)
        if (o !== NO_ENTRY) visit(i, o)
      }
    }
  }

  get(resId: number): ResEntry[] {
    return this.entries.get(resId >>> 0) ?? []
  }

  /**
   * Resolves a string resource, following references, preferring `locale`
   * ("de", "en-US"), then the default configuration.
   */
  resolveString(resId: number, locale?: string, depth = 0): string | undefined {
    if (depth > 8) return undefined
    const entries = this.get(resId)
    if (!entries.length) return undefined
    const [lang, country] = (locale ?? '').split(/[-_]/)
    const score = (c: ResConfig): number =>
      (lang && c.language === lang ? 4 : 0) + (country && c.country === country ? 2 : 0) + (c.language === '' ? 1 : 0)
    const sorted = [...entries].sort((a, b) => score(b.config) - score(a.config))
    for (const e of sorted) {
      if (e.value.type === 'string') return e.value.value
      if (e.value.type === 'ref') {
        const s = this.resolveString(e.value.value, locale, depth + 1)
        if (s) return s
      }
    }
    return undefined
  }

  /**
   * Candidate file paths for a drawable/mipmap, best first: raster images by
   * descending density, then XML (adaptive/vector) files.
   */
  resolveFiles(resId: number, depth = 0): string[] {
    if (depth > 8) return []
    const files: Array<{ path: string; density: number }> = []
    for (const e of this.get(resId)) {
      if (e.value.type === 'string') files.push({ path: e.value.value, density: e.config.density })
      else if (e.value.type === 'ref') for (const p of this.resolveFiles(e.value.value, depth + 1)) files.push({ path: p, density: e.config.density })
    }
    const isRaster = (p: string): boolean => /\.(png|webp|jpe?g)$/i.test(p)
    const rank = (d: number): number => (d === DENSITY_ANY || d === DENSITY_NONE ? 0 : d === 0 ? 160 : d)
    return [...new Set(
      files
        .sort((a, b) => Number(isRaster(b.path)) - Number(isRaster(a.path)) || rank(b.density) - rank(a.density))
        .map((f) => f.path)
    )]
  }
}

function toValue(dataType: number, data: number, pool: string[]): ResValue {
  if (dataType === TYPE_STRING) return { type: 'string', value: pool[data] ?? '' }
  if (dataType === TYPE_REFERENCE) return { type: 'ref', value: data >>> 0 }
  return { type: 'other', dataType, value: data }
}

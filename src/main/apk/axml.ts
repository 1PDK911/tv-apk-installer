// Parser for Android binary XML (the compiled AndroidManifest.xml inside an
// APK). Pure TypeScript, no aapt/Java. Format reference:
// frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h

export const RES_STRING_POOL_TYPE = 0x0001
const RES_XML_TYPE = 0x0003
const RES_XML_START_ELEMENT_TYPE = 0x0102
const RES_XML_END_ELEMENT_TYPE = 0x0103
const RES_XML_RESOURCE_MAP_TYPE = 0x0180

// Res_value data types
export const TYPE_REFERENCE = 0x01
export const TYPE_ATTRIBUTE = 0x02
export const TYPE_STRING = 0x03
export const TYPE_FLOAT = 0x04
export const TYPE_INT_DEC = 0x10
export const TYPE_INT_HEX = 0x11
export const TYPE_INT_BOOLEAN = 0x12

export type AttrValue = string | number | boolean | { ref: number }

export interface XmlAttr {
  name: string
  /** Android framework attribute resource id (e.g. 0x0101021b for versionCode), when known. */
  resId?: number
  value: AttrValue
}

export interface XmlElement {
  tag: string
  attrs: XmlAttr[]
  children: XmlElement[]
}

export class AxmlError extends Error {}

/** Reads a ResStringPool chunk starting at `off`. */
export function readStringPool(buf: Buffer, off: number): string[] {
  const headerSize = buf.readUInt16LE(off + 2)
  const stringCount = buf.readUInt32LE(off + 8)
  const flags = buf.readUInt32LE(off + 16)
  const stringsStart = buf.readUInt32LE(off + 20)
  const utf8 = (flags & 0x100) !== 0
  const offsetsAt = off + headerSize
  const dataAt = off + stringsStart
  const out: string[] = new Array(stringCount)
  for (let i = 0; i < stringCount; i++) {
    let p = dataAt + buf.readUInt32LE(offsetsAt + i * 4)
    try {
      if (utf8) {
        // utf16 length (1-2 bytes), then utf8 byte length (1-2 bytes)
        let n = buf[p++]
        if (n & 0x80) p++
        let len = buf[p++]
        if (len & 0x80) len = ((len & 0x7f) << 8) | buf[p++]
        out[i] = buf.toString('utf8', p, p + len)
      } else {
        let len = buf.readUInt16LE(p)
        p += 2
        if (len & 0x8000) {
          len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p)
          p += 2
        }
        out[i] = buf.toString('utf16le', p, p + len * 2)
      }
    } catch {
      out[i] = ''
    }
  }
  return out
}

/** Converts a Res_value to a JS value. Strings come from the given pool. */
export function resValue(dataType: number, data: number, pool: string[], raw?: number): AttrValue {
  switch (dataType) {
    case TYPE_STRING:
      return pool[data] ?? ''
    case TYPE_REFERENCE:
    case TYPE_ATTRIBUTE:
      return { ref: data >>> 0 }
    case TYPE_INT_BOOLEAN:
      return data !== 0
    case TYPE_INT_DEC:
    case TYPE_INT_HEX:
      return data | 0
    case TYPE_FLOAT: {
      const b = Buffer.alloc(4)
      b.writeUInt32LE(data >>> 0)
      return b.readFloatLE(0)
    }
    default:
      if (raw !== undefined && raw !== 0xffffffff && pool[raw] !== undefined) return pool[raw]
      return data | 0
  }
}

export function parseAxml(buf: Buffer): XmlElement {
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML_TYPE) throw new AxmlError('Not a binary XML file')
  let pool: string[] = []
  let resMap: number[] = []
  const root: XmlElement = { tag: '#root', attrs: [], children: [] }
  const stack: XmlElement[] = [root]
  let off = buf.readUInt16LE(2)
  const end = Math.min(buf.length, buf.readUInt32LE(4))

  while (off + 8 <= end) {
    const type = buf.readUInt16LE(off)
    const headerSize = buf.readUInt16LE(off + 2)
    const size = buf.readUInt32LE(off + 4)
    if (size < 8 || off + size > end) break
    switch (type) {
      case RES_STRING_POOL_TYPE:
        pool = readStringPool(buf, off)
        break
      case RES_XML_RESOURCE_MAP_TYPE: {
        resMap = []
        for (let p = off + headerSize; p + 4 <= off + size; p += 4) resMap.push(buf.readUInt32LE(p))
        break
      }
      case RES_XML_START_ELEMENT_TYPE: {
        const ext = off + headerSize
        const nameIdx = buf.readUInt32LE(ext + 4)
        const attrStart = buf.readUInt16LE(ext + 8)
        const attrSize = buf.readUInt16LE(ext + 10)
        const attrCount = buf.readUInt16LE(ext + 12)
        const el: XmlElement = { tag: pool[nameIdx] ?? '', attrs: [], children: [] }
        for (let i = 0; i < attrCount; i++) {
          const a = ext + attrStart + i * attrSize
          const nameI = buf.readUInt32LE(a + 4)
          const rawValue = buf.readUInt32LE(a + 8)
          const dataType = buf[a + 15]
          const data = buf.readUInt32LE(a + 16)
          const resId = nameI < resMap.length ? resMap[nameI] : undefined
          el.attrs.push({ name: pool[nameI] ?? '', resId, value: resValue(dataType, data, pool, rawValue) })
        }
        stack[stack.length - 1].children.push(el)
        stack.push(el)
        break
      }
      case RES_XML_END_ELEMENT_TYPE:
        if (stack.length > 1) stack.pop()
        break
      default:
        break // namespaces, CDATA: not needed
    }
    off += size
  }
  const manifest = root.children[0]
  if (!manifest) throw new AxmlError('Empty manifest')
  return manifest
}

// Android framework attribute ids (android.R.attr), stable across releases.
export const ATTR = {
  label: 0x01010001,
  icon: 0x01010002,
  name: 0x01010003,
  debuggable: 0x0101000f,
  minSdkVersion: 0x0101020c,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  required: 0x0101028e,
  targetSdkVersion: 0x01010270,
  testOnly: 0x01010272,
  banner: 0x010103f2,
  isFeatureSplit: 0x0101055b,
  versionCodeMajor: 0x01010576,
  isSplitRequired: 0x01010591,
  extractNativeLibs: 0x010104ea,
  enabled: 0x0101000e
} as const

/** Looks up an attribute by framework id first (robust to obfuscated names), then by name. */
export function attr(el: XmlElement, name: keyof typeof ATTR | string): AttrValue | undefined {
  const id = (ATTR as Record<string, number>)[name]
  if (id !== undefined) {
    const byId = el.attrs.find((a) => a.resId === id)
    if (byId) return byId.value
  }
  return el.attrs.find((a) => a.name === name && (a.resId === undefined || a.resId === id || id === undefined))?.value
}

export function findAll(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c) => c.tag === tag)
}

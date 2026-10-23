import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

export interface ZipEntryInfo {
  name: string
  compressedSize: number
  uncompressedSize: number
  encrypted: boolean
  isDirectory: boolean
}

/** Thin promise wrapper over yauzl with random access to entries. */
export class ZipReader {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    readonly entries: Map<string, yauzl.Entry>
  ) {}

  static async open(path: string): Promise<ZipReader> {
    const zip = await new Promise<yauzl.ZipFile>((res, rej) =>
      yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: false }, (err, z) =>
        err || !z ? rej(err ?? new Error('Could not open zip')) : res(z)
      )
    )
    const entries = new Map<string, yauzl.Entry>()
    await new Promise<void>((res, rej) => {
      zip.on('entry', (e: yauzl.Entry) => {
        entries.set(e.fileName, e)
        zip.readEntry()
      })
      zip.on('end', () => res())
      zip.on('error', rej)
      zip.readEntry()
    })
    return new ZipReader(zip, entries)
  }

  list(): ZipEntryInfo[] {
    return [...this.entries.values()].map((e) => ({
      name: e.fileName,
      compressedSize: e.compressedSize,
      uncompressedSize: e.uncompressedSize,
      // Bit 0 of the general purpose flags marks an encrypted entry.
      encrypted: (e.generalPurposeBitFlag & 0x1) !== 0,
      isDirectory: e.fileName.endsWith('/')
    }))
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  private stream(entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
    if (entry.generalPurposeBitFlag & 0x1) return Promise.reject(new EncryptedEntryError(entry.fileName))
    return new Promise((res, rej) =>
      this.zip.openReadStream(entry, (err, s) => (err || !s ? rej(err ?? new Error('Could not read entry')) : res(s)))
    )
  }

  async read(name: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Missing ${name}`)
    if (entry.uncompressedSize > maxBytes) throw new Error(`${name} is too large to read into memory`)
    const s = await this.stream(entry)
    const chunks: Buffer[] = []
    for await (const c of s as AsyncIterable<Buffer>) chunks.push(c)
    return Buffer.concat(chunks)
  }

  /** Extracts one entry to an exact destination file path. */
  async extractTo(name: string, destFile: string, signal?: AbortSignal): Promise<void> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Missing ${name}`)
    await mkdir(dirname(destFile), { recursive: true })
    const s = await this.stream(entry)
    await pipeline(s, createWriteStream(destFile), { signal })
  }

  close(): void {
    this.zip.close()
  }
}

export class EncryptedEntryError extends Error {
  constructor(name: string) {
    super(`${name} is encrypted`)
    this.name = 'EncryptedEntryError'
  }
}

/**
 * Resolves an archive entry name under destDir, refusing anything that would
 * escape it ("zip slip": ../, absolute paths, drive letters).
 */
export function safeJoin(destDir: string, entryName: string): string | undefined {
  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return undefined
  if (normalized.split('/').some((seg) => seg === '..')) return undefined
  const root = resolve(destDir)
  const target = resolve(root, normalized)
  if (target !== root && !target.startsWith(root + sep)) return undefined
  return target
}

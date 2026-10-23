import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import type { FileKind, QueuedFile } from '@shared/types'

export interface RegisteredFile extends QueuedFile {
  path: string
}

const KINDS: Record<string, FileKind> = { '.apk': 'apk', '.apks': 'apks', '.xapk': 'xapk', '.apkm': 'apkm' }

export function kindOf(path: string): FileKind | undefined {
  return KINDS[extname(path).toLowerCase()]
}

/**
 * Files the user explicitly dropped or picked. The renderer only ever refers
 * to them by id, so it can't ask the main process to read arbitrary paths.
 */
export class FileRegistry {
  private files = new Map<string, RegisteredFile>()

  async add(paths: unknown): Promise<{ added: QueuedFile[]; rejected: string[] }> {
    const added: QueuedFile[] = []
    const rejected: string[] = []
    if (!Array.isArray(paths)) return { added, rejected }
    for (const p of paths.slice(0, 100)) {
      if (typeof p !== 'string' || !isAbsolute(p)) continue
      const kind = kindOf(p)
      const name = basename(p)
      if (!kind) {
        rejected.push(`${name}: not an .apk, .apks, .xapk or .apkm file`)
        continue
      }
      try {
        const s = await stat(p)
        if (!s.isFile()) throw new Error('not a file')
        const f: RegisteredFile = { id: randomUUID(), name, size: s.size, kind, path: p }
        this.files.set(f.id, f)
        added.push({ id: f.id, name, size: s.size, kind })
      } catch {
        rejected.push(`${name}: can’t be read`)
      }
    }
    return { added, rejected }
  }

  get(id: unknown): RegisteredFile | undefined {
    return typeof id === 'string' ? this.files.get(id) : undefined
  }

  remove(id: unknown): void {
    if (typeof id === 'string') this.files.delete(id)
  }
}

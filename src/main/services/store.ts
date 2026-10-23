import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SavedTv } from '@shared/types'

export interface StoreData {
  tvs: SavedTv[]
  selectedTvId?: string
  setupGuideSeen?: boolean
}

const EMPTY: StoreData = { tvs: [] }

/** Tiny JSON file store in the app's data folder (atomic writes). */
export class Store {
  private data: StoreData = { ...EMPTY }
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async load(): Promise<StoreData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoreData>
      this.data = { ...EMPTY, ...parsed, tvs: Array.isArray(parsed.tvs) ? parsed.tvs.filter(isSavedTv) : [] }
    } catch {
      this.data = { ...EMPTY }
    }
    return this.get()
  }

  get(): StoreData {
    return structuredClone(this.data)
  }

  update(fn: (d: StoreData) => void): Promise<void> {
    fn(this.data)
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, snapshot, 'utf8')
      await rename(tmp, this.file)
    })
    return this.writing
  }
}

function isSavedTv(x: unknown): x is SavedTv {
  const t = x as SavedTv
  return (
    !!t &&
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.ip === 'string' &&
    typeof t.port === 'number' &&
    (t.method === 'wireless' || t.method === 'classic')
  )
}

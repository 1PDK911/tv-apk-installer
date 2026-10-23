import type { LogEntry } from '@shared/types'

type Listener = (entry: LogEntry) => void

const MAX_ENTRIES = 2000
const MAX_TEXT = 20_000

/** In-memory log of raw adb commands and output, streamed to the "Details" drawer. */
export class Log {
  private entries: LogEntry[] = []
  private listeners = new Set<Listener>()
  private nextId = 1

  add(kind: LogEntry['kind'], text: string): void {
    const trimmed = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n… (truncated)' : text
    const entry: LogEntry = { id: this.nextId++, time: Date.now(), kind, text: trimmed }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    for (const l of this.listeners) l(entry)
  }

  info(text: string): void {
    this.add('info', text)
  }

  all(): LogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

/** A log that discards everything; handy in tests. */
export const nullLog = new Log()

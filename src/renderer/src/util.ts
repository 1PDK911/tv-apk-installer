export const api = window.api

export const newJobId = (): string => crypto.randomUUID()

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** Error messages thrown across IPC arrive prefixed with "Error invoking remote method 'x': Error: ". */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** Tracks AbortControllers for long-running operations so the UI can cancel them. */
export class Jobs {
  private controllers = new Map<string, AbortController>()

  start(jobId: string): AbortSignal {
    this.controllers.get(jobId)?.abort()
    const c = new AbortController()
    this.controllers.set(jobId, c)
    return c.signal
  }

  cancel(jobId: string): void {
    this.controllers.get(jobId)?.abort()
    this.controllers.delete(jobId)
  }

  finish(jobId: string): void {
    this.controllers.delete(jobId)
  }

  async run<T>(jobId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.start(jobId)
    try {
      return await fn(signal)
    } finally {
      this.finish(jobId)
    }
  }
}

export function isJobId(x: unknown): x is string {
  return typeof x === 'string' && /^[\w-]{1,64}$/.test(x)
}

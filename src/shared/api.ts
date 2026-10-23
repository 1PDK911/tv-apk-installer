// The complete contract between the renderer and the main process. The preload
// exposes exactly these methods; the main process registers exactly these
// handlers and validates every argument.

import type {
  ActionResult,
  AdbStatus,
  ConnectRequest,
  DiscoveredService,
  JobProgress,
  LogEntry,
  PairRequest,
  PlatformToolsDownloadResult,
  TvView
} from './types'

export interface Api {
  // adb
  adbStatus(): Promise<AdbStatus>
  adbRecheck(): Promise<AdbStatus>
  downloadPlatformTools(jobId: string): Promise<PlatformToolsDownloadResult>

  // TVs
  listTvs(): Promise<TvView[]>
  discover(): Promise<DiscoveredService[]>
  pair(jobId: string, req: PairRequest): Promise<ActionResult>
  connect(jobId: string, req: ConnectRequest): Promise<ActionResult>
  reconnect(jobId: string, tvId: string): Promise<ActionResult>
  disconnect(tvId: string): Promise<ActionResult>
  forget(tvId: string): Promise<ActionResult>
  renameTv(tvId: string, name: string): Promise<ActionResult>
  setTvPort(jobId: string, tvId: string, ip: string, port: number): Promise<ActionResult>
  refreshInfo(tvId: string): Promise<TvView | undefined>
  selectTv(tvId: string | null): Promise<void>
  getSelectedTv(): Promise<string | null>

  // misc
  cancelJob(jobId: string): Promise<void>
  getLog(): Promise<LogEntry[]>
  clearLog(): Promise<void>
  openExternal(url: string): Promise<void>
  getSetupGuideSeen(): Promise<boolean>
  setSetupGuideSeen(): Promise<void>

  // events (return an unsubscribe function)
  onTvs(cb: (tvs: TvView[]) => void): () => void
  onLog(cb: (entry: LogEntry) => void): () => void
  onProgress(cb: (p: JobProgress) => void): () => void
}

export type ApiMethod = Exclude<keyof Api, 'onTvs' | 'onLog' | 'onProgress'>

/** Every invokable channel. The preload refuses anything not in this list. */
export const API_METHODS = [
  'adbStatus',
  'adbRecheck',
  'downloadPlatformTools',
  'listTvs',
  'discover',
  'pair',
  'connect',
  'reconnect',
  'disconnect',
  'forget',
  'renameTv',
  'setTvPort',
  'refreshInfo',
  'selectTv',
  'getSelectedTv',
  'cancelJob',
  'getLog',
  'clearLog',
  'openExternal',
  'getSetupGuideSeen',
  'setSetupGuideSeen'
] as const satisfies readonly ApiMethod[]

export const EVENTS = { tvs: 'evt:tvs', log: 'evt:log', progress: 'evt:progress' } as const

/** External links the app may open in the user's browser. Nothing else is allowed. */
export const EXTERNAL_LINKS = [
  'https://developer.android.com/studio/releases/platform-tools',
  'https://developer.android.com/studio/terms',
  'https://developer.android.com/tools/adb',
  'https://support.google.com/googletv'
] as const

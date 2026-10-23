// The complete contract between the renderer and the main process. The preload
// exposes exactly these methods; the main process registers exactly these
// handlers and validates every argument.

import type {
  ActionResult,
  InstallOptions,
  InstallResult,
  Inspection,
  LaunchResult,
  QueuedFile,
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

  // files & installing
  pickFiles(): Promise<{ added: QueuedFile[]; rejected: string[] }>
  /** Implemented in the preload: resolves dropped File objects to paths, then registers them. */
  addDroppedFiles(files: File[]): Promise<{ added: QueuedFile[]; rejected: string[] }>
  removeFile(fileId: string): Promise<void>
  inspect(jobId: string, fileId: string, tvId: string | null): Promise<Inspection>
  install(jobId: string, fileId: string, tvId: string, options: InstallOptions): Promise<InstallResult>
  launchApp(tvId: string, packageName: string): Promise<LaunchResult>

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

export type ApiMethod = Exclude<keyof Api, 'onTvs' | 'onLog' | 'onProgress' | 'addDroppedFiles'>

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
  'pickFiles',
  'addFiles',
  'removeFile',
  'inspect',
  'install',
  'launchApp',
  'cancelJob',
  'getLog',
  'clearLog',
  'openExternal',
  'getSetupGuideSeen',
  'setSetupGuideSeen'
] as const satisfies readonly (ApiMethod | 'addFiles')[]

export const EVENTS = { tvs: 'evt:tvs', log: 'evt:log', progress: 'evt:progress' } as const

/** External links the app may open in the user's browser. Nothing else is allowed. */
export const EXTERNAL_LINKS = [
  'https://developer.android.com/studio/releases/platform-tools',
  'https://developer.android.com/studio/terms',
  'https://developer.android.com/tools/adb',
  'https://support.google.com/googletv'
] as const

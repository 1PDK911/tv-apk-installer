// Types shared across main, preload and renderer.

export type AdbSource = 'path' | 'android-sdk' | 'app-data'

export interface AdbStatus {
  found: boolean
  path?: string
  source?: AdbSource
  version?: string
  /** True when the platform-tools version is new enough for `adb pair` (30.0.0+). */
  supportsPairing?: boolean
  error?: string
}

export type ConnectMethod = 'wireless' | 'classic'

export type TvState =
  | 'connected'
  | 'connecting'
  | 'unauthorized' // waiting for "Allow USB debugging?" on the TV
  | 'offline'
  | 'not_paired'
  | 'unreachable'
  | 'port_changed' // wireless debugging port is no longer valid and mDNS couldn't find it
  | 'disconnected'

export interface TvInfo {
  manufacturer?: string
  model?: string
  androidVersion?: string
  sdk?: number
  abis: string[]
  density?: number
  locale?: string
  serialNo?: string
  freeBytes?: number
  totalBytes?: number
}

export interface SavedTv {
  id: string
  name: string
  ip: string
  port: number
  method: ConnectMethod
  model?: string
  serialNo?: string
  lastConnectedAt?: number
}

export interface TvView extends SavedTv {
  state: TvState
  /** adb transport serial currently in use (ip:port or an mDNS name). */
  serial?: string
  message?: string
  info?: TvInfo
}

export interface DiscoveredService {
  instance: string
  type: 'connect' | 'pairing' | 'legacy'
  ip: string
  port: number
  /** Device serial number embedded in the instance name (adb-<serial>-<suffix>), if any. */
  serialNo?: string
}

export interface LogEntry {
  id: number
  time: number
  kind: 'cmd' | 'out' | 'err' | 'info'
  text: string
}

export interface JobProgress {
  jobId: string
  stage: string
  /** 0..1 when known, otherwise undefined for an indeterminate bar. */
  fraction?: number
  detail?: string
}

export interface PairRequest {
  ip: string
  pairingPort: number
  code: string
  connectPort: number
  name: string
}

export interface ConnectRequest {
  ip: string
  port: number
  method: ConnectMethod
  name: string
}

export interface ActionResult {
  ok: boolean
  message: string
  tv?: TvView
}

export interface PlatformToolsDownloadResult {
  ok: boolean
  message: string
  status?: AdbStatus
}

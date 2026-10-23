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
  /** For multi-step operations: all step names and the current one. */
  steps?: string[]
  stepIndex?: number
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

export type FileKind = 'apk' | 'apks' | 'xapk' | 'apkm'

/** A file the user dropped or picked. Paths stay in the main process; the UI only sees ids. */
export interface QueuedFile {
  id: string
  name: string
  size: number
  kind: FileKind
}

export type InstallRemedy = 'uninstall_reinstall' | 'bypass_low_target_sdk' | 'allow_test'

export interface InstallFailure {
  /** e.g. INSTALL_FAILED_OLDER_SDK, or a synthetic code like CONNECTION_LOST. */
  code: string
  title: string
  explanation: string
  fix: string
  remedy?: InstallRemedy
  raw: string
}

export interface InstallOptions {
  uninstallFirst?: boolean
  bypassLowTargetSdk?: boolean
  allowTest?: boolean
}

export interface InstallResult {
  ok: boolean
  cancelled?: boolean
  message: string
  packageName?: string
  versionName?: string
  failure?: InstallFailure
}

export interface LaunchResult {
  ok: boolean
  message: string
}

export interface TvSuitability {
  /** Has an activity with the LEANBACK_LAUNCHER category (shows on the TV home screen). */
  leanbackLauncher: boolean
  /** <uses-feature android:name="android.software.leanback">: required / optional / absent. */
  leanbackFeature: 'required' | 'optional' | 'absent'
  /** Declares a required touchscreen (a strong sign of a phone-only app). */
  touchscreenRequired: boolean
  /** Has a TV banner image. */
  hasBanner: boolean
}

export interface ApkInfo {
  fileId: string
  fileName: string
  kind: FileKind
  packageName: string
  label?: string
  versionName?: string
  versionCode?: number
  minSdk?: number
  targetSdk?: number
  /** data: URL of the launcher icon (PNG/WebP/JPEG only; adaptive vector icons aren't rendered). */
  icon?: string
  /** Native ABIs the app ships code for. Empty = no native code (runs on any CPU). */
  abis: string[]
  sizeBytes: number
  sha256: string
  tv: TvSuitability
  testOnly: boolean
  debuggable: boolean
  /** Bundle details (.apks/.xapk/.apkm). */
  bundle?: BundleInfo
}

export interface SplitInfo {
  name: string
  /** "base", "abi", "density", "language", "feature" or "other". */
  type: 'base' | 'abi' | 'density' | 'language' | 'feature' | 'other'
  value?: string
  sizeBytes: number
  selected: boolean
}

export interface BundleInfo {
  splits: SplitInfo[]
  obbs: { name: string; sizeBytes: number }[]
  /** Explains how splits were chosen for the selected TV. */
  selectionNote?: string
}

export type CheckLevel = 'ok' | 'info' | 'warn' | 'block'

export interface PreflightCheck {
  id: 'api' | 'abi' | 'storage' | 'installed' | 'downgrade' | 'phone' | 'target' | 'test' | 'signature' | 'bundle'
  level: CheckLevel
  title: string
  detail?: string
}

export interface InstalledState {
  installed: boolean
  versionName?: string
  versionCode?: number
}

export interface Inspection {
  info?: ApkInfo
  error?: string
  checks: PreflightCheck[]
  installed?: InstalledState
}

export interface TvApp {
  packageName: string
  versionName?: string
  versionCode?: number
  /** Human-readable source: "Play Store", "Sideloaded", or the installer package. */
  source: string
  enabled: boolean
  lastUpdateTime?: string
}

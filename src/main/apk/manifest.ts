import { type AttrValue, type XmlElement, attr, findAll, parseAxml } from './axml'

export interface UsesFeature {
  name: string
  required: boolean
}

export interface ManifestInfo {
  packageName: string
  versionCode: number
  versionName?: string
  minSdk?: number
  targetSdk?: number
  /** A literal label, or a resource reference to resolve with resources.arsc. */
  label?: string | { ref: number }
  iconRef?: number
  bannerRef?: number
  /** Split name for split APKs (e.g. "config.xhdpi"); undefined for the base APK. */
  split?: string
  isFeatureSplit: boolean
  testOnly: boolean
  debuggable: boolean
  usesFeatures: UsesFeature[]
  hasLeanbackLauncher: boolean
  hasLauncher: boolean
  leanbackActivity?: string
  launcherActivity?: string
}

const num = (v: AttrValue | undefined): number | undefined => {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  return undefined
}
const str = (v: AttrValue | undefined): string | undefined => (typeof v === 'string' ? v : undefined)
const bool = (v: AttrValue | undefined, dflt: boolean): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? v === 'true' : typeof v === 'number' ? v !== 0 : dflt

function qualify(pkg: string, name: string | undefined): string | undefined {
  if (!name) return undefined
  if (name.startsWith('.')) return pkg + name
  if (!name.includes('.')) return `${pkg}.${name}`
  return name
}

/** Finds launchable activities (MAIN + LEANBACK_LAUNCHER / LAUNCHER). */
function launchers(app: XmlElement | undefined, pkg: string): { leanback?: string; launcher?: string; hasLeanback: boolean; hasLauncher: boolean } {
  const result = { leanback: undefined as string | undefined, launcher: undefined as string | undefined, hasLeanback: false, hasLauncher: false }
  if (!app) return result
  for (const act of [...findAll(app, 'activity'), ...findAll(app, 'activity-alias')]) {
    if (attr(act, 'enabled') === false) continue
    for (const f of findAll(act, 'intent-filter')) {
      const actions = findAll(f, 'action').map((a) => str(attr(a, 'name')))
      if (!actions.includes('android.intent.action.MAIN')) continue
      const cats = findAll(f, 'category').map((c) => str(attr(c, 'name')))
      const name = qualify(pkg, str(attr(act, 'name')))
      if (cats.includes('android.intent.category.LEANBACK_LAUNCHER')) {
        result.hasLeanback = true
        result.leanback ??= name
      }
      if (cats.includes('android.intent.category.LAUNCHER')) {
        result.hasLauncher = true
        result.launcher ??= name
      }
    }
  }
  return result
}

export function parseManifest(buf: Buffer): ManifestInfo {
  const m = parseAxml(buf)
  if (m.tag !== 'manifest') throw new Error('Not an AndroidManifest')
  const packageName = str(attr(m, 'package')) ?? ''
  const major = num(attr(m, 'versionCodeMajor')) ?? 0
  const minor = num(attr(m, 'versionCode')) ?? 0
  const sdk = findAll(m, 'uses-sdk')[0]
  const app = findAll(m, 'application')[0]
  const label = app ? attr(app, 'label') : undefined
  const ref = (v: AttrValue | undefined): number | undefined => (v && typeof v === 'object' ? v.ref : undefined)
  const l = launchers(app, packageName)
  return {
    packageName,
    versionCode: major * 2 ** 32 + (minor >>> 0),
    versionName: str(attr(m, 'versionName')),
    minSdk: sdk ? num(attr(sdk, 'minSdkVersion')) ?? 1 : 1,
    targetSdk: sdk ? num(attr(sdk, 'targetSdkVersion')) ?? num(attr(sdk, 'minSdkVersion')) : undefined,
    label: typeof label === 'string' || (label && typeof label === 'object') ? (label as string | { ref: number }) : undefined,
    iconRef: app ? ref(attr(app, 'icon')) : undefined,
    bannerRef: app ? ref(attr(app, 'banner')) : undefined,
    split: str(attr(m, 'split')),
    isFeatureSplit: bool(attr(m, 'isFeatureSplit'), false),
    testOnly: app ? bool(attr(app, 'testOnly'), false) : false,
    debuggable: app ? bool(attr(app, 'debuggable'), false) : false,
    usesFeatures: findAll(m, 'uses-feature')
      .map((f) => ({ name: str(attr(f, 'name')) ?? '', required: bool(attr(f, 'required'), true) }))
      .filter((f) => f.name),
    hasLeanbackLauncher: l.hasLeanback,
    hasLauncher: l.hasLauncher,
    leanbackActivity: l.leanback,
    launcherActivity: l.launcher
  }
}

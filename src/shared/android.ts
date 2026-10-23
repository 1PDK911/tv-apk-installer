/** Android release names by API level, for plain-English messages. */
const VERSIONS: Record<number, string> = {
  16: '4.1', 17: '4.2', 18: '4.3', 19: '4.4', 21: '5.0', 22: '5.1', 23: '6', 24: '7.0', 25: '7.1',
  26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16', 37: '17'
}

export function androidName(api: number | undefined): string {
  if (!api) return 'unknown'
  const v = VERSIONS[api]
  return v ? `Android ${v} (API ${api})` : `API ${api}`
}

/** The minimum targetSdk Android will install, by device API level (Android 14+ blocks old targets). */
export function minInstallableTargetSdk(deviceSdk: number | undefined): number | undefined {
  if (!deviceSdk) return undefined
  if (deviceSdk >= 35) return 24
  if (deviceSdk >= 34) return 23
  return undefined
}

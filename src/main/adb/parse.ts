// Pure parsers for adb output. Covered by tests in test/parse.test.ts against
// recorded fixtures. Note that adb usually exits 0 even when an operation
// failed, so the text is the source of truth.

import type { DiscoveredService } from '@shared/types'

const lines = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trimEnd())

// ---------- adb version ----------

export interface AdbVersion {
  protocol?: string // "1.0.41"
  version?: string // "35.0.2-12147458"
  major?: number // 35
}

export function parseVersion(out: string): AdbVersion {
  const protocol = /Android Debug Bridge version ([\d.]+)/.exec(out)?.[1]
  const version = /^Version ([^\s]+)/m.exec(out)?.[1]
  const major = version ? Number(/^(\d+)/.exec(version)?.[1]) : undefined
  return { protocol, version, major: Number.isFinite(major) ? major : undefined }
}

// ---------- adb devices -l ----------

export type DeviceState = 'device' | 'unauthorized' | 'offline' | 'authorizing' | 'connecting' | 'no permissions' | string

export interface DeviceEntry {
  serial: string
  state: DeviceState
  props: Record<string, string>
}

export function parseDevices(out: string): DeviceEntry[] {
  const result: DeviceEntry[] = []
  for (const line of lines(out)) {
    if (!line || line.startsWith('*') || line.startsWith('List of devices')) continue
    // serial<whitespace>state[ key:value ...]; "no permissions" contains a space.
    const m = /^(\S+)\s+(no permissions(?: \([^)]*\))?|\S+)(.*)$/.exec(line)
    if (!m) continue
    const props: Record<string, string> = {}
    for (const tok of m[3].trim().split(/\s+/)) {
      const i = tok.indexOf(':')
      if (i > 0) props[tok.slice(0, i)] = tok.slice(i + 1)
    }
    result.push({ serial: m[1], state: m[2].startsWith('no permissions') ? 'no permissions' : m[2], props })
  }
  return result
}

// ---------- adb connect ----------

export type ConnectOutcome =
  | { kind: 'connected'; already: boolean }
  | { kind: 'auth_failed' } // RSA/TLS authentication failed: not approved yet, or not paired
  | { kind: 'refused' }
  | { kind: 'timeout' }
  | { kind: 'no_route' }
  | { kind: 'bad_host' }
  | { kind: 'unknown'; text: string }

export function parseConnect(out: string): ConnectOutcome {
  const t = out.trim()
  if (/^already connected to /m.test(t)) return { kind: 'connected', already: true }
  if (/^connected to /m.test(t)) return { kind: 'connected', already: false }
  if (/failed to authenticate/i.test(t)) return { kind: 'auth_failed' }
  if (/refused/i.test(t)) return { kind: 'refused' }
  if (/timed out|timeout/i.test(t)) return { kind: 'timeout' }
  if (/no route to host|network is unreachable|host is down|unreachable/i.test(t)) return { kind: 'no_route' }
  if (/resolve host|cannot resolve|no such host|name or service not known/i.test(t)) return { kind: 'bad_host' }
  return { kind: 'unknown', text: t }
}

// ---------- adb pair ----------

export type PairOutcome =
  | { kind: 'paired'; guid?: string }
  | { kind: 'wrong_code' }
  | { kind: 'cannot_start' }
  | { kind: 'unknown'; text: string }

export function parsePair(out: string): PairOutcome {
  const t = out.trim()
  const ok = /Successfully paired to \S+(?: \[guid=([^\]]+)\])?/.exec(t)
  if (ok) return { kind: 'paired', guid: ok[1] }
  if (/wrong password|connection was dropped/i.test(t)) return { kind: 'wrong_code' }
  if (/unable to start pairing client/i.test(t)) return { kind: 'cannot_start' }
  return { kind: 'unknown', text: t }
}

// ---------- adb mdns ----------

/** `adb mdns check` prints e.g. "mdns daemon version [Openscreen discovery 0.0.0]" when available. */
export function parseMdnsCheck(out: string): boolean {
  return /mdns daemon version/i.test(out) && !/unavailable|error/i.test(out)
}

/**
 * `adb mdns services` prints a header and one tab-separated line per service:
 *   adb-<serial>-<suffix>\t_adb-tls-connect._tcp\t192.168.1.20:37145
 * Parsing is whitespace-tolerant because spacing varies between adb releases.
 */
export function parseMdnsServices(out: string): DiscoveredService[] {
  const result: DiscoveredService[] = []
  const seen = new Set<string>()
  for (const line of lines(out)) {
    const m = /^(\S+)\s+(_adb(?:-tls-(?:connect|pairing))?)\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\s*$/.exec(
      line.trim()
    )
    if (!m) continue
    const [, instance, svc, ip, portStr] = m
    const type = svc === '_adb-tls-connect' ? 'connect' : svc === '_adb-tls-pairing' ? 'pairing' : 'legacy'
    const key = `${instance}|${type}|${ip}:${portStr}`
    if (seen.has(key)) continue
    seen.add(key)
    const serialNo = /^adb-(.+)-[A-Za-z0-9]{6}$/.exec(instance)?.[1]
    result.push({ instance, type, ip, port: Number(portStr), serialNo })
  }
  return result
}

/** Device serials reported by adb for mDNS-connected transports look like "adb-<serial>-<suffix>._adb-tls-connect._tcp". */
export function serialNoFromMdnsTransport(serial: string): string | undefined {
  return /^adb-(.+)-[A-Za-z0-9]{6}\._adb-tls-connect\._tcp\.?$/.exec(serial)?.[1]
}

// ---------- getprop / df / wm density ----------

export function parseGetprop(out: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const m of out.matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]\s*$/gm)) props[m[1]] = m[2]
  return props
}

/** Parses `df -k <path>`; returns bytes, or undefined if the output is unexpected. */
export function parseDf(out: string): { totalBytes: number; freeBytes: number } | undefined {
  const ls = lines(out).filter(Boolean)
  const headerIdx = ls.findIndex((l) => /^Filesystem/i.test(l))
  if (headerIdx < 0) return undefined
  // Long filesystem names may wrap the data row onto the next line; join them.
  const data = ls.slice(headerIdx + 1).join(' ').trim().split(/\s+/)
  const nums = data.filter((t) => /^\d+$/.test(t)).map(Number)
  if (nums.length < 3) return undefined
  const [total, , avail] = nums
  return { totalBytes: total * 1024, freeBytes: avail * 1024 }
}

export function parseWmDensity(out: string): number | undefined {
  const override = /Override density:\s*(\d+)/.exec(out)?.[1]
  const physical = /Physical density:\s*(\d+)/.exec(out)?.[1]
  const v = Number(override ?? physical)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

// ---------- remote shell quoting ----------

/**
 * `adb shell a b c` joins its arguments with spaces and hands them to the TV's
 * /bin/sh. Anything that is not a simple token must be single-quoted for the
 * *remote* shell. (There is no local shell involved: we spawn adb directly.)
 */
export function shQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

// ---------- dumpsys package / pm ----------

export interface InstalledPackage {
  versionName?: string
  versionCode?: number
  minSdk?: number
  targetSdk?: number
  codePath?: string
}

/** Parses `dumpsys package <pkg>`. Returns undefined when the package isn't installed. */
export function parsePackageDump(out: string, pkg: string): InstalledPackage | undefined {
  // Only look inside the "Package [pkg]" block (dumpsys can also list other packages).
  const start = out.indexOf(`Package [${pkg}]`)
  if (start < 0) return undefined
  const rest = out.slice(start)
  const nextPkg = rest.indexOf('\n  Package [', 1)
  const block = nextPkg > 0 ? rest.slice(0, nextPkg) : rest
  const vc = /versionCode=(\d+)/.exec(block)?.[1]
  const min = /minSdk=(\d+)/.exec(block)?.[1]
  const target = /targetSdk=(\d+)/.exec(block)?.[1]
  return {
    versionName: /versionName=([^\r\n]*)/.exec(block)?.[1]?.trim(),
    versionCode: vc ? Number(vc) : undefined,
    minSdk: min ? Number(min) : undefined,
    targetSdk: target ? Number(target) : undefined,
    codePath: /codePath=([^\r\n]+)/.exec(block)?.[1]?.trim()
  }
}

/** Parses `cmd package resolve-activity --brief …`; returns "pkg/.Activity" or undefined. */
export function parseResolveActivity(out: string): string | undefined {
  const ls = lines(out).map((l) => l.trim()).filter(Boolean)
  const last = ls[ls.length - 1]
  return last && /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(last) ? last : undefined
}

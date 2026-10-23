// Input validation shared by the renderer (for instant feedback) and the main
// process (the authority — every IPC payload is re-checked there).

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string }

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function validateIp(input: unknown): Validation<string> {
  if (typeof input !== 'string') return { ok: false, error: 'Enter the TV’s IP address.' }
  const ip = input.trim()
  if (!ip) return { ok: false, error: 'Enter the TV’s IP address.' }
  if (!IPV4.test(ip)) return { ok: false, error: 'That doesn’t look like an IP address. It should look like 192.168.1.42.' }
  if (ip === '0.0.0.0' || ip.startsWith('255.')) return { ok: false, error: 'That address can’t be a TV.' }
  return { ok: true, value: ip }
}

export function validatePort(input: unknown): Validation<number> {
  const s = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : ''
  if (!/^\d{1,5}$/.test(s)) return { ok: false, error: 'The port is a number between 1 and 65535.' }
  const n = Number(s)
  if (n < 1 || n > 65535) return { ok: false, error: 'The port is a number between 1 and 65535.' }
  return { ok: true, value: n }
}

export function validatePairingCode(input: unknown): Validation<string> {
  const s = typeof input === 'string' ? input.replace(/\s+/g, '') : ''
  if (!/^\d{6}$/.test(s)) return { ok: false, error: 'The pairing code is the 6 digits shown on the TV.' }
  return { ok: true, value: s }
}

/** Accepts "ip" or "ip:port". */
export function validateHostPort(input: unknown, defaultPort?: number): Validation<{ ip: string; port: number }> {
  if (typeof input !== 'string') return { ok: false, error: 'Enter an IP address.' }
  const [ipPart, portPart, ...rest] = input.trim().split(':')
  if (rest.length) return { ok: false, error: 'Use the form 192.168.1.42:5555.' }
  const ip = validateIp(ipPart)
  if (!ip.ok) return ip
  if (portPart === undefined || portPart === '') {
    if (defaultPort === undefined) return { ok: false, error: 'Include the port, e.g. 192.168.1.42:37145.' }
    return { ok: true, value: { ip: ip.value, port: defaultPort } }
  }
  const port = validatePort(portPart)
  if (!port.ok) return port
  return { ok: true, value: { ip: ip.value, port: port.value } }
}

export function validateTvName(input: unknown): Validation<string> {
  const s = typeof input === 'string' ? input.trim() : ''
  if (!s) return { ok: false, error: 'Give the TV a name.' }
  if (s.length > 40) return { ok: false, error: 'Keep the name under 40 characters.' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: 'The name contains invalid characters.' }
  return { ok: true, value: s }
}

/** Android package names: segments of [A-Za-z][A-Za-z0-9_]*, at least one dot in practice. */
export function isValidPackageName(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 255 && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(s)
}

/** adb transport serials we produced or read from `adb devices`. */
export function isValidSerial(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 200 && /^[A-Za-z0-9._:\-[\]]+$/.test(s)
}

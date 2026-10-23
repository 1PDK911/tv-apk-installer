import { describe, expect, it } from 'vitest'
import {
  parseConnect,
  parseDevices,
  parseDf,
  parseGetprop,
  parseMdnsServices,
  parsePair,
  parseVersion,
  parseWmDensity,
  serialNoFromMdnsTransport,
  shQuote
} from '../src/main/adb/parse'
import { adbFixture } from './helpers'

describe('parseVersion', () => {
  it('reads a recorded adb version', () => {
    expect(parseVersion(adbFixture('version.txt'))).toEqual({ protocol: '1.0.41', version: '34.0.4-debian', major: 34 })
  })
  it('handles garbage', () => {
    expect(parseVersion('nope')).toEqual({ protocol: undefined, version: undefined, major: undefined })
  })
})

describe('parseDevices', () => {
  it('returns nothing for an empty list (recorded)', () => {
    expect(parseDevices(adbFixture('devices-empty.txt'))).toEqual([])
  })
  it('ignores daemon start-up noise', () => {
    expect(parseDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n')).toEqual([])
  })
  it('parses states and properties', () => {
    const d = parseDevices(adbFixture('devices-tvs.txt'))
    expect(d.map((x) => [x.serial, x.state])).toEqual([
      ['192.168.1.42:5555', 'device'],
      ['192.168.1.50:5555', 'unauthorized'],
      ['adb-4C111FDAQ00XYZ-AbCdEf._adb-tls-connect._tcp', 'device'],
      ['192.168.1.77:41235', 'offline']
    ])
    expect(d[0].props.model).toBe('Chromecast')
  })
  it('handles "no permissions" with a space', () => {
    const d = parseDevices('List of devices attached\nABC123 no permissions (user in plugdev group); see [http://x]\n')
    expect(d[0]).toMatchObject({ serial: 'ABC123', state: 'no permissions' })
  })
})

describe('parseConnect', () => {
  it.each([
    ['connect-ok.txt', { kind: 'connected', already: false }],
    ['connect-already.txt', { kind: 'connected', already: true }],
    ['connect-auth.txt', { kind: 'auth_failed' }],
    ['connect-refused.txt', { kind: 'refused' }],
    ['connect-timeout.txt', { kind: 'timeout' }],
    ['connect-no-route.txt', { kind: 'no_route' }],
    ['connect-bad-host.txt', { kind: 'bad_host' }]
  ])('%s', (file, expected) => {
    expect(parseConnect(adbFixture(file))).toEqual(expected)
  })
  it('keeps unknown text', () => {
    expect(parseConnect('something odd')).toEqual({ kind: 'unknown', text: 'something odd' })
  })
})

describe('parsePair', () => {
  it('success with guid', () => {
    expect(parsePair(adbFixture('pair-ok.txt'))).toEqual({ kind: 'paired', guid: 'adb-4C111FDAQ00XYZ-AbCdEf' })
  })
  it('wrong code', () => expect(parsePair(adbFixture('pair-wrong.txt'))).toEqual({ kind: 'wrong_code' }))
  it('cannot start (recorded)', () =>
    expect(parsePair(adbFixture('pair-cannot-start.txt'))).toEqual({ kind: 'cannot_start' }))
})

describe('parseMdnsServices', () => {
  it('empty (recorded)', () => expect(parseMdnsServices(adbFixture('mdns-services-empty.txt'))).toEqual([]))
  it('parses all three service types', () => {
    expect(parseMdnsServices(adbFixture('mdns-services.txt'))).toEqual([
      { instance: 'adb-4C111FDAQ00XYZ-AbCdEf', type: 'connect', ip: '192.168.1.60', port: 41235, serialNo: '4C111FDAQ00XYZ' },
      { instance: 'adb-4C111FDAQ00XYZ-AbCdEf', type: 'pairing', ip: '192.168.1.60', port: 37145, serialNo: '4C111FDAQ00XYZ' },
      { instance: 'adb-GZ1234567-Q1w2E3', type: 'legacy', ip: '192.168.1.42', port: 5555, serialNo: 'GZ1234567' }
    ])
  })
  it('tolerates space separators, trailing dots and duplicates', () => {
    const out = 'List of discovered mdns services\nadb-X-abcdef  _adb-tls-connect._tcp.  10.0.0.5:4000\nadb-X-abcdef  _adb-tls-connect._tcp.  10.0.0.5:4000\n'
    expect(parseMdnsServices(out)).toHaveLength(1)
  })
  it('extracts serials from mDNS transport names', () => {
    expect(serialNoFromMdnsTransport('adb-4C111FDAQ00XYZ-AbCdEf._adb-tls-connect._tcp')).toBe('4C111FDAQ00XYZ')
    expect(serialNoFromMdnsTransport('192.168.1.2:5555')).toBeUndefined()
  })
})

describe('device info parsers', () => {
  it('getprop', () => {
    const p = parseGetprop(adbFixture('getprop.txt'))
    expect(p['ro.product.model']).toBe('Google TV Streamer')
    expect(p['ro.product.cpu.abilist']).toBe('arm64-v8a,armeabi-v7a,armeabi')
  })
  it('df', () => {
    expect(parseDf(adbFixture('df.txt'))).toEqual({ totalBytes: 5418476 * 1024, freeBytes: 2056560 * 1024 })
  })
  it('df with a wrapped filesystem name', () => {
    expect(parseDf(adbFixture('df-wrapped.txt'))).toEqual({ totalBytes: 10485760 * 1024, freeBytes: 8388608 * 1024 })
  })
  it('df garbage', () => expect(parseDf('df: /data: Permission denied')).toBeUndefined())
  it('wm density prefers override', () => {
    expect(parseWmDensity(adbFixture('wm-density.txt'))).toBe(320)
    expect(parseWmDensity(adbFixture('wm-density-override.txt'))).toBe(280)
  })
})

describe('shQuote (remote shell)', () => {
  it('leaves simple tokens alone', () => {
    expect(shQuote('com.example.app')).toBe('com.example.app')
    expect(shQuote('/sdcard/Android/obb/com.x/main.1.com.x.obb')).toBe('/sdcard/Android/obb/com.x/main.1.com.x.obb')
  })
  it('quotes metacharacters', () => {
    expect(shQuote('a b')).toBe("'a b'")
    expect(shQuote('$(reboot)')).toBe("'$(reboot)'")
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
    expect(shQuote('x;rm -rf /')).toBe("'x;rm -rf /'")
  })
})

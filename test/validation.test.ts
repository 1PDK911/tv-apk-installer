import { describe, expect, it } from 'vitest'
import {
  isValidPackageName,
  validateHostPort,
  validateIp,
  validatePairingCode,
  validatePort,
  validateTvName
} from '../src/shared/validation'

describe('validation', () => {
  it('ip', () => {
    expect(validateIp(' 192.168.1.42 ')).toEqual({ ok: true, value: '192.168.1.42' })
    for (const bad of ['', '192.168.1', '256.1.1.1', '1.2.3.4.5', '01.2.3.4', 'tv.local', '1.2.3.4; rm', '0.0.0.0', 5])
      expect(validateIp(bad).ok).toBe(false)
  })
  it('port', () => {
    expect(validatePort('5555')).toEqual({ ok: true, value: 5555 })
    expect(validatePort(41235)).toEqual({ ok: true, value: 41235 })
    for (const bad of ['0', '65536', '-1', '12a', '', '1e3']) expect(validatePort(bad).ok).toBe(false)
  })
  it('pairing code', () => {
    expect(validatePairingCode('123 456')).toEqual({ ok: true, value: '123456' })
    for (const bad of ['12345', '1234567', 'abcdef', '', null]) expect(validatePairingCode(bad).ok).toBe(false)
  })
  it('host:port', () => {
    expect(validateHostPort('10.0.0.2:41235')).toEqual({ ok: true, value: { ip: '10.0.0.2', port: 41235 } })
    expect(validateHostPort('10.0.0.2', 5555)).toEqual({ ok: true, value: { ip: '10.0.0.2', port: 5555 } })
    expect(validateHostPort('10.0.0.2').ok).toBe(false)
    expect(validateHostPort('10.0.0.2:1:2').ok).toBe(false)
  })
  it('names and packages', () => {
    expect(validateTvName('  Bedroom ').ok).toBe(true)
    expect(validateTvName('x'.repeat(41)).ok).toBe(false)
    expect(validateTvName('a\nb').ok).toBe(false)
    expect(isValidPackageName('com.netflix.ninja')).toBe(true)
    expect(isValidPackageName('com.x;reboot')).toBe(false)
    expect(isValidPackageName('nodots')).toBe(false)
  })
})

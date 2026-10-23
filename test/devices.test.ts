import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/client'
import { Log } from '../src/main/log'
import { DeviceService, findConnectService, matchDevice } from '../src/main/services/devices'
import { Store } from '../src/main/services/store'
import { redactArgs } from '../src/main/services/adbManager'
import { parseDevices } from '../src/main/adb/parse'
import type { SavedTv, TvView } from '../src/shared/types'
import { FakeRunner, adbFixture } from './helpers'

async function setup(runner: FakeRunner, tvs: SavedTv[] = []) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'tvapk-')), 'settings.json'))
  await store.load()
  await store.update((d) => (d.tvs = tvs))
  const emitted: TvView[][] = []
  const svc = new DeviceService(() => new AdbClient(runner), store, new Log(), (t) => emitted.push(t))
  return { svc, store, emitted }
}

const infoRules = (r: FakeRunner): FakeRunner =>
  r
    .on(/shell getprop$/, adbFixture('getprop.txt'))
    .on(/shell df -k \/data$/, adbFixture('df.txt'))
    .on(/shell wm density$/, adbFixture('wm-density.txt'))

describe('matchDevice', () => {
  const devices = parseDevices(adbFixture('devices-tvs.txt'))
  const tv = (p: Partial<SavedTv>): SavedTv => ({ id: '1', name: 'x', ip: '1.1.1.1', port: 5555, method: 'classic', ...p })
  it('exact ip:port', () => expect(matchDevice(tv({ ip: '192.168.1.42' }), devices)?.serial).toBe('192.168.1.42:5555'))
  it('mDNS transport by serial number', () =>
    expect(matchDevice(tv({ ip: '192.168.1.60', port: 1, serialNo: '4C111FDAQ00XYZ' }), devices)?.state).toBe('device'))
  it('same ip, new port', () => expect(matchDevice(tv({ ip: '192.168.1.77', port: 3333 }), devices)?.state).toBe('offline'))
  it('no match', () => expect(matchDevice(tv({ ip: '10.9.9.9' }), devices)).toBeUndefined())
})

describe('findConnectService', () => {
  it('prefers serial number, falls back to ip', () => {
    const services = [
      { instance: 'a', type: 'connect' as const, ip: '10.0.0.1', port: 1, serialNo: 'S1' },
      { instance: 'b', type: 'connect' as const, ip: '10.0.0.2', port: 2, serialNo: 'S2' }
    ]
    const base: SavedTv = { id: '1', name: 'x', ip: '10.0.0.2', port: 9, method: 'wireless' }
    expect(findConnectService({ ...base, serialNo: 'S1' }, services)?.port).toBe(1)
    expect(findConnectService(base, services)?.port).toBe(2)
  })
})

describe('DeviceService', () => {
  it('classic connect that needs approval on the TV', async () => {
    const r = new FakeRunner()
      .on('connect 192.168.1.50:5555', adbFixture('connect-ok.txt'))
      .on('devices -l', adbFixture('devices-tvs.txt'))
    const { svc } = await setup(r)
    const res = await svc.connect({ ip: '192.168.1.50', port: 5555, method: 'classic', name: 'Bedroom' })
    expect(res.ok).toBe(true)
    expect(res.tv?.state).toBe('unauthorized')
    expect(res.message).toMatch(/Always allow from this computer/)
  })

  it('classic connect that succeeds loads TV details and remembers the TV', async () => {
    const r = infoRules(
      new FakeRunner().on('connect 192.168.1.42:5555', adbFixture('connect-ok.txt')).on('devices -l', adbFixture('devices-tvs.txt'))
    )
    const { svc, store } = await setup(r)
    const res = await svc.connect({ ip: '192.168.1.42', port: 5555, method: 'classic', name: 'Living room' })
    expect(res.ok).toBe(true)
    expect(res.tv?.state).toBe('connected')
    expect(res.tv?.info).toMatchObject({ sdk: 34, abis: ['arm64-v8a', 'armeabi-v7a', 'armeabi'], density: 320, freeBytes: 2056560 * 1024 })
    expect(store.get().tvs[0]).toMatchObject({ name: 'Living room', model: 'Google TV Streamer', serialNo: '4C111FDAQ00XYZ' })
  })

  it('wireless: rediscovers a changed port via mDNS', async () => {
    const r = infoRules(
      new FakeRunner()
        .on('connect 192.168.1.60:40000', adbFixture('connect-refused.txt'))
        .on('mdns services', adbFixture('mdns-services.txt'))
        .on('connect 192.168.1.60:41235', 'connected to 192.168.1.60:41235')
        .on('devices -l', 'List of devices attached\n192.168.1.60:41235\tdevice product:x model:y transport_id:1\n')
    )
    const { svc, store } = await setup(r, [{ id: 'tv1', name: 'Streamer', ip: '192.168.1.60', port: 40000, method: 'wireless' }])
    const res = await svc.connectTv('tv1')
    expect(res.ok).toBe(true)
    expect(store.get().tvs[0].port).toBe(41235)
  })

  it('wireless: refused and not discoverable asks for the new port', async () => {
    const r = new FakeRunner().on(/^connect /, adbFixture('connect-refused.txt')).on('mdns services', adbFixture('mdns-services-empty.txt'))
    const { svc } = await setup(r, [{ id: 'tv1', name: 'Streamer', ip: '192.168.1.61', port: 40000, method: 'wireless' }])
    const res = await svc.connectTv('tv1')
    expect(res.ok).toBe(false)
    expect(svc.get('tv1')?.state).toBe('port_changed')
  })

  it('wireless: authentication failure means not paired', async () => {
    const r = new FakeRunner().on(/^connect /, adbFixture('connect-auth.txt'))
    const { svc } = await setup(r, [{ id: 'tv1', name: 'Streamer', ip: '192.168.1.60', port: 40000, method: 'wireless' }])
    await svc.connectTv('tv1')
    expect(svc.get('tv1')?.state).toBe('not_paired')
  })

  it('classic: timeout is unreachable with plain-English advice', async () => {
    const r = new FakeRunner().on(/^connect /, adbFixture('connect-timeout.txt'))
    const { svc } = await setup(r, [{ id: 'tv1', name: 'TV', ip: '192.168.1.99', port: 5555, method: 'classic' }])
    const res = await svc.connectTv('tv1')
    expect(svc.get('tv1')?.state).toBe('unreachable')
    expect(res.message).toMatch(/same Wi-Fi/)
  })

  it('pair → connect, records serial number from guid', async () => {
    const r = infoRules(
      new FakeRunner()
        .on('pair 192.168.1.60:37145 123456', adbFixture('pair-ok.txt'))
        .on('connect 192.168.1.60:41235', 'connected to 192.168.1.60:41235')
        .on('devices -l', 'List of devices attached\n192.168.1.60:41235\tdevice transport_id:1\n')
    )
    const { svc } = await setup(r)
    const res = await svc.pair({ ip: '192.168.1.60', pairingPort: 37145, code: '123456', connectPort: 41235, name: 'Streamer' })
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/^Paired and connected/)
    expect(res.tv?.serialNo).toBe('4C111FDAQ00XYZ')
  })

  it('pair with the wrong code explains what to do', async () => {
    const r = new FakeRunner().on(/^pair /, adbFixture('pair-wrong.txt'))
    const { svc } = await setup(r)
    const res = await svc.pair({ ip: '192.168.1.60', pairingPort: 37145, code: '000000', connectPort: 41235, name: 'x' })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/new code/)
    expect(svc.list()).toHaveLength(0)
  })

  it('refresh tracks approval and disconnection', async () => {
    let list = 'List of devices attached\n192.168.1.50:5555\tunauthorized transport_id:4\n'
    const r = infoRules(new FakeRunner().on('devices -l', () => list))
    const { svc } = await setup(r, [{ id: 'tv1', name: 'TV', ip: '192.168.1.50', port: 5555, method: 'classic' }])
    await svc.refresh()
    expect(svc.get('tv1')?.state).toBe('unauthorized')
    list = 'List of devices attached\n192.168.1.50:5555\tdevice transport_id:4\n'
    await svc.refresh()
    expect(svc.get('tv1')?.state).toBe('connected')
    list = 'List of devices attached\n\n'
    await svc.refresh()
    expect(svc.get('tv1')?.state).toBe('disconnected')
  })

  it('forget removes the TV from the store', async () => {
    const r = new FakeRunner().on(/^disconnect /, '')
    const { svc, store } = await setup(r, [{ id: 'tv1', name: 'TV', ip: '1.2.3.4', port: 5555, method: 'classic' }])
    await svc.forget('tv1')
    expect(store.get().tvs).toEqual([])
  })
})

describe('redactArgs', () => {
  it('hides the pairing code in logs', () => {
    expect(redactArgs(['pair', '1.2.3.4:5', '123456'])).toEqual(['pair', '1.2.3.4:5', '******'])
    expect(redactArgs(['connect', '1.2.3.4:5'])).toEqual(['connect', '1.2.3.4:5'])
  })
})

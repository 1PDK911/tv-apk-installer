import { describe, expect, it } from 'vitest'
import { abiCompatible, preflight, requiredBytes } from '../src/main/services/preflight'
import type { ApkInfo, TvInfo } from '../src/shared/types'

const MB = 1024 * 1024
const app = (p: Partial<ApkInfo> = {}): ApkInfo => ({
  fileId: 'f',
  fileName: 'a.apk',
  kind: 'apk',
  packageName: 'com.example.tvapp',
  versionName: '1.2.0',
  versionCode: 3,
  minSdk: 21,
  targetSdk: 33,
  abis: ['arm64-v8a', 'armeabi-v7a'],
  sizeBytes: 50 * MB,
  sha256: 'x',
  tv: { leanbackLauncher: true, leanbackFeature: 'optional', touchscreenRequired: false, hasBanner: true },
  testOnly: false,
  debuggable: false,
  ...p
})
const tv = (p: Partial<TvInfo> = {}): TvInfo => ({ sdk: 34, abis: ['arm64-v8a', 'armeabi-v7a', 'armeabi'], freeBytes: 4000 * MB, ...p })
const ids = (c: ReturnType<typeof preflight>) => c.map((x) => `${x.id}:${x.level}`)

describe('preflight', () => {
  it('clean TV app on a capable TV has no checks', () => expect(preflight(app(), tv())).toEqual([]))
  it('API level too low', () => {
    const c = preflight(app({ minSdk: 30 }), tv({ sdk: 28 }))
    expect(ids(c)).toEqual(['api:block'])
    expect(c[0].title).toBe('Needs Android 11 (API 30) — your TV has Android 9 (API 28)')
  })
  it('ABI mismatch', () => {
    expect(ids(preflight(app({ abis: ['x86_64'] }), tv()))).toEqual(['abi:block'])
    expect(ids(preflight(app({ abis: ['arm64-v8a'] }), tv({ abis: ['armeabi-v7a', 'armeabi'] })))).toEqual(['abi:block'])
    expect(ids(preflight(app({ abis: [] }), tv({ abis: ['x86'] })))).toEqual([])
  })
  it('low storage: warn when tight, block when it cannot fit at all', () => {
    expect(ids(preflight(app({ sizeBytes: 300 * MB }), tv({ freeBytes: 500 * MB })))).toEqual(['storage:warn'])
    expect(ids(preflight(app({ sizeBytes: 600 * MB }), tv({ freeBytes: 500 * MB })))).toEqual(['storage:block'])
  })
  it('installed: update, same version, downgrade', () => {
    expect(preflight(app(), tv(), { installed: true, versionName: '1.0.0', versionCode: 1 })[0]).toMatchObject({
      id: 'installed',
      level: 'info',
      title: 'Update: v1.0.0 → v1.2.0'
    })
    expect(preflight(app(), tv(), { installed: true, versionName: '1.2.0', versionCode: 3 })[0].title).toMatch(/same version/)
    expect(preflight(app(), tv(), { installed: true, versionName: '2.0', versionCode: 9 })[0]).toMatchObject({
      id: 'downgrade',
      level: 'warn',
      title: 'Downgrade: v2.0 is installed, this is v1.2.0'
    })
  })
  it('phone-only app', () => {
    const c = preflight(app({ tv: { leanbackLauncher: false, leanbackFeature: 'absent', touchscreenRequired: true, hasBanner: false } }), tv())
    expect(ids(c)).toEqual(['phone:warn'])
    expect(c[0].detail).toMatch(/touchscreen.*home screen/)
  })
  it('old target SDK on Android 14 and 15', () => {
    expect(ids(preflight(app({ targetSdk: 22 }), tv({ sdk: 34 })))).toEqual(['target:warn'])
    expect(ids(preflight(app({ targetSdk: 23 }), tv({ sdk: 35 })))).toEqual(['target:warn'])
    expect(ids(preflight(app({ targetSdk: 22 }), tv({ sdk: 33 })))).toEqual([])
  })
  it('test build is informational', () => expect(ids(preflight(app({ testOnly: true }), tv()))).toEqual(['test:info']))
  it('no TV info: only app-intrinsic checks', () =>
    expect(ids(preflight(app({ tv: { leanbackLauncher: false, leanbackFeature: 'absent', touchscreenRequired: false, hasBanner: false } }), undefined))).toEqual([
      'phone:warn'
    ]))
})

describe('helpers', () => {
  it('abiCompatible', () => {
    expect(abiCompatible(['armeabi-v7a'], ['arm64-v8a', 'armeabi-v7a'])).toBe(true)
    expect(abiCompatible(['arm64-v8a'], ['armeabi-v7a'])).toBe(false)
  })
  it('requiredBytes counts selected splits and OBBs', () => {
    expect(
      requiredBytes(
        app({
          bundle: {
            splits: [
              { name: 'base', type: 'base', sizeBytes: 10, selected: true },
              { name: 'x86', type: 'abi', value: 'x86', sizeBytes: 100, selected: false }
            ],
            obbs: [{ name: 'main.obb', sizeBytes: 5 }]
          }
        })
      )
    ).toBe(25)
  })
})

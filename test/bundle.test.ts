import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apkEntries, classifySplit, extractBundle, obbEntries, pickAbi, pickDensity, selectSplits } from '../src/main/apk/bundle'
import { buildPlan, inspectFile } from '../src/main/services/plans'
import type { RegisteredFile } from '../src/main/services/files'
import type { TvInfo } from '../src/shared/types'

const fx = (n: string): string => join(__dirname, 'fixtures', 'apk', n)
const work = (): string => mkdtempSync(join(tmpdir(), 'tvapk-bundle-'))
const file = (name: string, kind: RegisteredFile['kind']): RegisteredFile => ({ id: name, name, kind, size: 1, path: fx(name) })
const streamer: TvInfo = { sdk: 34, abis: ['arm64-v8a', 'armeabi-v7a', 'armeabi'], density: 320, locale: 'de-DE' }
const oldTv: TvInfo = { sdk: 28, abis: ['armeabi-v7a', 'armeabi'], density: 213, locale: 'en-US' }

describe('split classification', () => {
  it.each([
    [undefined, { type: 'base', module: 'base' }],
    ['config.arm64_v8a', { type: 'abi', value: 'arm64-v8a', module: 'base' }],
    ['config.xxhdpi', { type: 'density', value: 'xxhdpi', module: 'base' }],
    ['config.de', { type: 'language', value: 'de', module: 'base' }],
    ['config.zh_TW', { type: 'language', value: 'zh_TW', module: 'base' }],
    ['player.config.x86', { type: 'abi', value: 'x86', module: 'player' }],
    ['player', { type: 'feature', value: 'player', module: 'player' }]
  ])('%s', (split, expected) => expect(classifySplit(split as string | undefined, false)).toEqual(expected))
})

describe('selection rules', () => {
  it('density: closest at or above, else highest below', () => {
    expect(pickDensity(['mdpi', 'xhdpi', 'xxhdpi'], 320)).toBe('xhdpi')
    expect(pickDensity(['mdpi', 'xhdpi', 'xxhdpi'], 213)).toBe('xhdpi')
    expect(pickDensity(['mdpi', 'hdpi'], 480)).toBe('hdpi')
    expect(pickDensity([], 320)).toBeUndefined()
  })
  it('ABI: TV preference order', () => {
    expect(pickAbi(['armeabi-v7a', 'arm64-v8a'], streamer.abis)).toBe('arm64-v8a')
    expect(pickAbi(['armeabi-v7a', 'arm64-v8a'], oldTv.abis)).toBe('armeabi-v7a')
    expect(pickAbi(['x86'], oldTv.abis)).toBeUndefined()
  })
  it('selects one ABI, one density, TV language + English', () => {
    const splits = ['base', 'arm64-v8a', 'armeabi-v7a', 'xhdpi', 'mdpi', 'de', 'fr', 'en'].map((v, i) => ({
      name: v,
      module: 'base',
      type: (i === 0 ? 'base' : i < 3 ? 'abi' : i < 5 ? 'density' : 'language') as 'base' | 'abi' | 'density' | 'language',
      value: v,
      sizeBytes: 1,
      selected: false
    }))
    const note = selectSplits(splits, streamer)
    expect(splits.filter((s) => s.selected).map((s) => s.name)).toEqual(['base', 'arm64-v8a', 'xhdpi', 'de', 'en'])
    expect(note).toBe('Chosen for this TV: processor: arm64-v8a · screen: xhdpi · languages: de, en')
  })
  it('entry discovery', () => {
    expect(apkEntries(['toc.pb', 'splits/base-master.apk', 'standalones/standalone-x86.apk'])).toEqual(['splits/base-master.apk'])
    expect(apkEntries(['standalones/a.apk', 'standalones/b.apk'])).toEqual(['standalones/a.apk'])
    expect(obbEntries(['Android/obb/com.x/main.1.com.x.obb', 'evil/../x.obb', 'a.txt'])).toEqual(['Android/obb/com.x/main.1.com.x.obb', 'evil/../x.obb'])
  })
})

describe.each([
  ['sai.apks', 'apks'],
  ['bundletool.apks', 'apks'],
  ['app.xapk', 'xapk'],
  ['app.apkm', 'apkm']
] as const)('%s', (name, kind) => {
  it('inspects as one app with all splits', async () => {
    const info = await inspectFile(file(name, kind), streamer, work())
    expect(info).toMatchObject({ packageName: 'com.example.splitapp', label: 'Example TV App', versionCode: 12, minSdk: 21 })
    expect(info.icon).toMatch(/^data:image\/png/)
    const b = info.bundle!
    expect(b.splits.map((s) => s.name).sort()).toEqual(
      ['base', 'config.arm64_v8a', 'config.armeabi_v7a', 'config.de', 'config.fr', 'config.mdpi', 'config.x86', 'config.xhdpi'].sort()
    )
    expect(b.splits.filter((s) => s.selected).map((s) => s.name).sort()).toEqual(['base', 'config.arm64_v8a', 'config.de', 'config.xhdpi'])
    expect(b.obbs.map((o) => o.name)).toEqual(kind === 'xapk' ? ['main.12.com.example.splitapp.obb'] : [])
  })
  it('plans install-multiple with base first, and cleans up', async () => {
    const dir = work()
    const { plan, cleanup } = await buildPlan(file(name, kind), oldTv, dir)
    expect(plan.packageName).toBe('com.example.splitapp')
    // base + armeabi-v7a (the TV’s first ABI) + xhdpi (closest at or above 213 dpi); the bundle has no English split
    expect(plan.apks).toHaveLength(3)
    expect(plan.apks.every((p) => existsSync(p) && p.endsWith('.apk'))).toBe(true)
    expect(plan.obbs.length).toBe(kind === 'xapk' ? 1 : 0)
    await cleanup()
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('encrypted .apkm', () => {
  it('is reported in plain English', async () => {
    await expect(inspectFile(file('encrypted.apkm', 'apkm'), streamer, work())).rejects.toThrow(/\.apkm file is encrypted.*APKMirror/)
  })
  it('leaves no temp files behind', async () => {
    const dir = work()
    await extractBundle(fx('encrypted.apkm'), 'apkm', dir, { withObbs: false }).catch(() => undefined)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('not a bundle', () => {
  it('explains', async () => {
    await expect(inspectFile({ ...file('tv-app.apk', 'apks') }, streamer, work())).rejects.toThrow(/no base APK|doesn’t contain any APKs|isn’t a valid/)
  })
})

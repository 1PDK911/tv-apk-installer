import { copyFileSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/client'
import { parseAllPackages, parsePmList, parsePmPath } from '../src/main/adb/parse'
import { AppManager, describeInstaller } from '../src/main/services/apps'
import { inspectFile } from '../src/main/services/plans'
import { ZipReader } from '../src/main/zip'
import { FakeRunner, adbFixture } from './helpers'

const S = '192.168.1.42:5555'
const tmp = (): string => mkdtempSync(join(tmpdir(), 'tvapk-apps-'))

describe('parsers', () => {
  it('pm list packages', () => {
    expect(parsePmList(adbFixture('pm-list-3.txt'))).toEqual([
      { packageName: 'com.netflix.ninja', versionCode: 120 },
      { packageName: 'com.example.tvapp', versionCode: 5 },
      { packageName: 'org.videolan.vlc', versionCode: 13050407 }
    ])
    expect(parsePmList('package:/data/app/x/base.apk=com.a.b\n')).toEqual([{ packageName: 'com.a.b', versionCode: undefined }])
  })
  it('dumpsys package packages', () => {
    const m = parseAllPackages(adbFixture('dumpsys-packages.txt'))
    expect(m.get('com.netflix.ninja')).toMatchObject({ versionName: '8.120.0 build 18 50618', installer: 'com.android.vending' })
    expect(m.get('com.example.tvapp')).toMatchObject({ versionName: '1.4.0', installer: undefined })
    expect(m.get('org.videolan.vlc')?.versionCode).toBe(13050407)
  })
  it('pm path: base first, rejects odd paths', () => {
    expect(parsePmPath(adbFixture('pm-path-split.txt'))[0]).toMatch(/base\.apk$/)
    expect(parsePmPath('package:/data/app/x/base.apk\npackage:/data/app/$(reboot).apk\npackage:/a/../b.apk\n')).toEqual(['/data/app/x/base.apk'])
  })
  it('installer names', () => {
    expect(describeInstaller('com.android.vending')).toBe('Play Store')
    expect(describeInstaller(undefined)).toBe('Sideloaded')
  })
})

describe('AppManager', () => {
  it('lists user apps with versions, source and disabled state', async () => {
    const r = new FakeRunner()
      .on(/pm list packages -3 --show-versioncode$/, adbFixture('pm-list-3.txt'))
      .on(/pm list packages -3 -d$/, adbFixture('pm-list-3-disabled.txt'))
      .on(/dumpsys package packages$/, adbFixture('dumpsys-packages.txt'))
    const apps = await new AppManager(new AdbClient(r)).list(S)
    expect(apps).toEqual([
      { packageName: 'com.example.tvapp', versionName: '1.4.0', versionCode: 5, source: 'Sideloaded', enabled: true, lastUpdateTime: '2026-10-20 19:00:00' },
      { packageName: 'com.netflix.ninja', versionName: '8.120.0 build 18 50618', versionCode: 120, source: 'Play Store', enabled: true, lastUpdateTime: '2026-09-30 08:12:44' },
      { packageName: 'org.videolan.vlc', versionName: '3.6.0', versionCode: 13050407, source: 'Sideloaded (adb)', enabled: false, lastUpdateTime: undefined }
    ])
  })

  it('saves a split app as a reinstallable .apks', async () => {
    // The fake "TV" serves the fixture split APKs when pulled.
    const splitsDir = tmp()
    const sai = await ZipReader.open(join(__dirname, 'fixtures/apk/sai.apks'))
    await sai.extractTo('base.apk', join(splitsDir, 'base.apk'))
    await sai.extractTo('split_config.arm64_v8a.apk', join(splitsDir, 'split_config.arm64_v8a.apk'))
    await sai.extractTo('split_config.xhdpi.apk', join(splitsDir, 'split_config.xhdpi.apk'))
    sai.close()
    const r = new FakeRunner()
      .on(/shell pm path com.example.splitapp$/, adbFixture('pm-path-split.txt'))
      .on(/ pull /, (args) => {
        copyFileSync(join(splitsDir, args[3].split('/').pop()!), args[4])
        return `${args[3]}: 1 file pulled, 0 skipped. 40.0 MB/s (100 bytes in 0.001s)`
      })
    const work = tmp()
    const dest = join(tmp(), 'copy.apks')
    const progress: number[] = []
    const res = await new AppManager(new AdbClient(r)).saveCopy(S, 'com.example.splitapp', dest, work, (d) => progress.push(d))
    expect(res).toEqual({ files: 3, path: dest })
    expect(progress).toEqual([0, 1, 2, 3])
    expect(readdirSync(work)).toEqual([])
    // Round trip: the saved bundle opens as the same app with all three splits.
    const info = await inspectFile({ id: 'x', name: 'copy.apks', kind: 'apks', size: statSync(dest).size, path: dest }, undefined, tmp())
    expect(info.packageName).toBe('com.example.splitapp')
    expect(info.bundle?.splits.map((s) => s.name).sort()).toEqual(['base', 'config.arm64_v8a', 'config.xhdpi'])
  })

  it('saves a single APK directly', async () => {
    const dest = join(tmp(), 'one.apk')
    const r = new FakeRunner()
      .on(/pm path/, 'package:/data/app/x/base.apk')
      .on(/ pull /, (args) => {
        copyFileSync(join(__dirname, 'fixtures/apk/tv-app.apk'), args[4])
        return '1 file pulled'
      })
    const res = await new AppManager(new AdbClient(r)).saveCopy(S, 'com.example.tvapp', dest, tmp(), () => undefined)
    expect(res.files).toBe(1)
    expect(statSync(dest).size).toBe(statSync(join(__dirname, 'fixtures/apk/tv-app.apk')).size)
  })

  it('reports pull failures', async () => {
    const r = new FakeRunner().on(/pm path/, 'package:/data/app/x/base.apk').on(/ pull /, "adb: error: failed to stat remote object '/data/app/x/base.apk': Permission denied")
    await expect(new AppManager(new AdbClient(r)).saveCopy(S, 'com.x.y', join(tmp(), 'a.apk'), tmp(), () => undefined)).rejects.toThrow(/Permission denied/)
  })
})

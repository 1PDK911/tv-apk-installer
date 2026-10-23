import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/client'
import { parsePackageDump, parseResolveActivity } from '../src/main/adb/parse'
import { Log } from '../src/main/log'
import { type InstallPlan, Installer, installArgs } from '../src/main/services/install'
import { FakeRunner, adbFixture } from './helpers'

const plan = (p: Partial<InstallPlan> = {}): InstallPlan => ({
  packageName: 'com.example.tvapp',
  versionName: '1.2.0',
  apks: ['C:\\Users\\me\\Downloads\\My App (1).apk'],
  obbs: [],
  totalBytes: 1000,
  ctx: {},
  ...p
})
const S = '192.168.1.42:5555'

describe('installArgs', () => {
  it('passes file paths as single arguments (no shell)', () => {
    expect(installArgs(S, plan(), {})).toEqual(['-s', S, 'install', '-r', 'C:\\Users\\me\\Downloads\\My App (1).apk'])
  })
  it('adds retry flags', () => {
    expect(installArgs(S, plan(), { allowTest: true, bypassLowTargetSdk: true })).toEqual([
      '-s', S, 'install', '-r', '-t', '--bypass-low-target-sdk-block', 'C:\\Users\\me\\Downloads\\My App (1).apk'
    ])
  })
  it('uses install-multiple for splits', () => {
    expect(installArgs(S, plan({ apks: ['a.apk', 'b.apk'] }), {})).toEqual(['-s', S, 'install-multiple', '-r', 'a.apk', 'b.apk'])
  })
})

describe('Installer', () => {
  const steps: string[][] = []
  const report = (s: string[], i: number): void => void steps.push([s[i]])

  it('installs and verifies the version on the TV', async () => {
    const r = new FakeRunner()
      .on(/ install -r /, adbFixture('install-success.txt'))
      .on(/shell dumpsys package com.example.tvapp$/, adbFixture('dumpsys-package.txt'))
    const res = await new Installer(new AdbClient(r), new Log()).install(S, plan(), {}, report)
    expect(res).toEqual({ ok: true, packageName: 'com.example.tvapp', versionName: '1.4.0', message: 'Installed version 1.4.0.' })
  })

  it('maps failures', async () => {
    const r = new FakeRunner().on(/ install /, adbFixture('install-update-incompatible.txt'))
    const res = await new Installer(new AdbClient(r), new Log()).install(S, plan(), {}, report)
    expect(res.ok).toBe(false)
    expect(res.failure?.remedy).toBe('uninstall_reinstall')
  })

  it('uninstalls first when asked', async () => {
    const r = new FakeRunner()
      .on(`-s ${S} uninstall com.example.tvapp`, 'Success')
      .on(/ install -r /, adbFixture('install-success.txt'))
      .on(/dumpsys/, adbFixture('dumpsys-package.txt'))
    const res = await new Installer(new AdbClient(r), new Log()).install(S, plan(), { uninstallFirst: true }, report)
    expect(res.ok).toBe(true)
    expect(r.calls.map((c) => c[2])).toEqual(['uninstall', 'install', 'shell'])
  })

  it('pushes OBB files to the app’s obb folder', async () => {
    const r = new FakeRunner()
      .on(/ install-multiple /, adbFixture('install-success.txt'))
      .on(/shell mkdir -p \/sdcard\/Android\/obb\/com.example.tvapp$/, '')
      .on(/ push /, '/tmp/main.obb: 1 file pushed, 0 skipped. 30.2 MB/s (700 bytes in 0.001s)')
      .on(/dumpsys/, adbFixture('dumpsys-package.txt'))
    const res = await new Installer(new AdbClient(r), new Log()).install(
      S,
      plan({ apks: ['a.apk', 'b.apk'], obbs: [{ local: '/tmp/main.obb', name: 'main.5.com.example.tvapp.obb' }] }),
      {},
      report
    )
    expect(res.ok).toBe(true)
    expect(r.calls.find((c) => c[2] === 'push')).toEqual([
      '-s', S, 'push', '/tmp/main.obb', '/sdcard/Android/obb/com.example.tvapp/main.5.com.example.tvapp.obb'
    ])
  })

  it('reports cancellation', async () => {
    const ac = new AbortController()
    ac.abort()
    const res = await new Installer(new AdbClient(new FakeRunner()), new Log()).install(S, plan(), {}, report, ac.signal)
    expect(res).toMatchObject({ ok: false, cancelled: true })
  })

  it('launches via LEANBACK_LAUNCHER', async () => {
    const r = new FakeRunner()
      .on(/resolve-activity .* android.intent.category.LEANBACK_LAUNCHER com.example.tvapp$/, adbFixture('resolve-activity.txt'))
      .on(/am start .* -n com.example.tvapp\/.MainActivity$/, adbFixture('am-start.txt'))
    const res = await new Installer(new AdbClient(r), new Log()).launch(S, 'com.example.tvapp')
    expect(res).toEqual({ ok: true, message: 'Opened on the TV.' })
  })

  it('falls back to LAUNCHER for phone apps', async () => {
    const r = new FakeRunner()
      .on(/resolve-activity .*LEANBACK_LAUNCHER/, adbFixture('resolve-activity-none.txt'))
      .on(/resolve-activity .*category.LAUNCHER/, 'com.x.y/.Main')
      .on(/am start/, 'Starting: Intent { cmp=com.x.y/.Main }')
    const res = await new Installer(new AdbClient(r), new Log()).launch(S, 'com.x.y')
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/phone-style/)
  })

  it('refuses invalid package names', async () => {
    const r = new FakeRunner()
    const res = await new Installer(new AdbClient(r), new Log()).launch(S, 'x; reboot')
    expect(res.ok).toBe(false)
    expect(r.calls).toEqual([])
  })
})

describe('package parsers', () => {
  it('dumpsys package', () => {
    expect(parsePackageDump(adbFixture('dumpsys-package.txt'), 'com.example.tvapp')).toEqual({
      versionName: '1.4.0',
      versionCode: 5,
      minSdk: 21,
      targetSdk: 33,
      codePath: '/data/app/~~abc==/com.example.tvapp-xyz=='
    })
    expect(parsePackageDump(adbFixture('dumpsys-package.txt'), 'com.other')).toBeUndefined()
  })
  it('resolve-activity', () => {
    expect(parseResolveActivity(adbFixture('resolve-activity.txt'))).toBe('com.example.tvapp/.MainActivity')
    expect(parseResolveActivity(adbFixture('resolve-activity-none.txt'))).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { parseManifest } from '../src/main/apk/manifest'
import { ZipReader } from '../src/main/zip'

const apk = (n: string): string => join(__dirname, 'fixtures', 'apk', n)
async function manifestOf(file: string) {
  const z = await ZipReader.open(apk(file))
  try {
    return parseManifest(await z.read('AndroidManifest.xml'))
  } finally {
    z.close()
  }
}

describe('parseManifest', () => {
  it('TV app', async () => {
    const m = await manifestOf('tv-app.apk')
    expect(m).toMatchObject({
      packageName: 'com.example.tvapp',
      versionCode: 3,
      versionName: '1.2.0',
      minSdk: 21,
      targetSdk: 33,
      hasLeanbackLauncher: true,
      hasLauncher: false,
      leanbackActivity: 'com.example.tvapp.MainActivity',
      testOnly: false,
      split: undefined
    })
    expect(m.label).toEqual({ ref: expect.any(Number) })
    expect(m.iconRef).toBeTypeOf('number')
    expect(m.bannerRef).toBeTypeOf('number')
    expect(m.usesFeatures).toEqual([
      { name: 'android.software.leanback', required: false },
      { name: 'android.hardware.touchscreen', required: false }
    ])
  })
  it('phone-only test app', async () => {
    const m = await manifestOf('phone-app.apk')
    expect(m).toMatchObject({
      packageName: 'org.example.phoneonly',
      versionCode: 70,
      versionName: '7.0-beta',
      minSdk: 26,
      targetSdk: 22,
      label: 'Phone Only',
      testOnly: true,
      hasLeanbackLauncher: false,
      hasLauncher: true,
      launcherActivity: 'org.example.phoneonly.Main'
    })
    expect(m.usesFeatures).toEqual([{ name: 'android.hardware.touchscreen', required: true }])
  })
  it('rejects non-manifests', () => {
    expect(() => parseManifest(Buffer.from('<?xml version="1.0"?><manifest/>'))).toThrow()
  })
})

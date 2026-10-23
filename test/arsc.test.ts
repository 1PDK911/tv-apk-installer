import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ResourceTable } from '../src/main/apk/arsc'
import { inspectApk } from '../src/main/apk/inspect'
import { parseManifest } from '../src/main/apk/manifest'
import { ZipReader } from '../src/main/zip'

const apk = (n: string): string => join(__dirname, 'fixtures', 'apk', n)

describe('ResourceTable', () => {
  it('resolves localized labels and density-ranked icons', async () => {
    const z = await ZipReader.open(apk('tv-app.apk'))
    const m = parseManifest(await z.read('AndroidManifest.xml'))
    const t = new ResourceTable(await z.read('resources.arsc'))
    z.close()
    const labelRef = (m.label as { ref: number }).ref
    expect(t.resolveString(labelRef)).toBe('Example TV App')
    expect(t.resolveString(labelRef, 'de-DE')).toBe('Beispiel-TV-App')
    expect(t.resolveString(labelRef, 'fr')).toBe('Example TV App')
    expect(t.resolveFiles(m.iconRef!)).toEqual(['res/mipmap-xhdpi-v4/ic_launcher.png', 'res/mipmap-mdpi-v4/ic_launcher.png'])
  })
  it('rejects garbage', () => expect(() => new ResourceTable(Buffer.from('nope nope nope'))).toThrow())
})

describe('inspectApk', () => {
  it('builds a full info card for a TV app', async () => {
    const info = await inspectApk({ id: 'f1', name: 'tv-app.apk', path: apk('tv-app.apk'), size: 13061, kind: 'apk' })
    expect(info).toMatchObject({
      packageName: 'com.example.tvapp',
      label: 'Example TV App',
      versionName: '1.2.0',
      versionCode: 3,
      minSdk: 21,
      targetSdk: 33,
      abis: ['arm64-v8a', 'armeabi-v7a'],
      tv: { leanbackLauncher: true, leanbackFeature: 'optional', touchscreenRequired: false, hasBanner: true },
      testOnly: false
    })
    expect(info.icon).toMatch(/^data:image\/png;base64,iVBOR/)
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('phone app with a literal label', async () => {
    const info = await inspectApk({ id: 'f2', name: 'phone-app.apk', path: apk('phone-app.apk'), size: 1, kind: 'apk' })
    expect(info).toMatchObject({
      label: 'Phone Only',
      abis: ['x86_64'],
      testOnly: true,
      tv: { leanbackLauncher: false, leanbackFeature: 'absent', touchscreenRequired: true, hasBanner: false }
    })
  })
  it('explains non-zip files', async () => {
    await expect(
      inspectApk({ id: 'x', name: 'x.apk', path: join(__dirname, 'fixtures', 'repository2-3.xml'), size: 1, kind: 'apk' })
    ).rejects.toThrow(/isn’t a valid APK/)
  })
})

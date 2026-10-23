import { describe, expect, it } from 'vitest'
import { candidatePaths } from '../src/main/adb/locate'
import { hostOs, latestUrl, parseRepository } from '../src/main/services/platformTools'
import { safeJoin } from '../src/main/zip'
import { fixture } from './helpers'

describe('parseRepository', () => {
  const xml = fixture('repository2-3.xml')
  it('picks the stable Windows archive with its checksum', () => {
    expect(parseRepository(xml, 'windows')).toEqual({
      url: 'https://dl.google.com/android/repository/platform-tools_r36.0.2-win.zip',
      sha1: '1234567890abcdef1234567890abcdef12345678',
      size: 6912345,
      version: '36.0.2'
    })
  })
  it('other OSes', () => {
    expect(parseRepository(xml, 'macosx')?.url).toMatch(/darwin\.zip$/)
    expect(parseRepository(xml, 'linux')?.url).toMatch(/linux\.zip$/)
  })
  it('returns undefined for junk', () => expect(parseRepository('<html/>', 'windows')).toBeUndefined())
  it('fallback url', () => {
    expect(latestUrl('windows')).toBe('https://dl.google.com/android/repository/platform-tools-latest-windows.zip')
    expect(latestUrl('macosx')).toBe('https://dl.google.com/android/repository/platform-tools-latest-darwin.zip')
    expect(hostOs('win32')).toBe('windows')
  })
})

describe('candidatePaths (Windows)', () => {
  it('orders PATH, Android SDK, then app data; skips relative PATH entries', () => {
    const c = candidatePaths(
      { Path: 'C:\\Windows\\system32;.;"C:\\tools\\platform-tools";', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      'win32',
      'C:\\Users\\me\\AppData\\Roaming\\TV APK Installer\\platform-tools',
      'C:\\Users\\me'
    )
    expect(c).toEqual([
      { path: 'C:\\Windows\\system32\\adb.exe', source: 'path' },
      { path: 'C:\\tools\\platform-tools\\adb.exe', source: 'path' },
      { path: 'C:\\Users\\me\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe', source: 'android-sdk' },
      { path: 'C:\\Users\\me\\AppData\\Roaming\\TV APK Installer\\platform-tools\\adb.exe', source: 'app-data' }
    ])
  })
})

describe('safeJoin', () => {
  it('blocks zip-slip', () => {
    expect(safeJoin('/tmp/x', 'platform-tools/adb')).toBe('/tmp/x/platform-tools/adb')
    expect(safeJoin('/tmp/x', '../evil')).toBeUndefined()
    expect(safeJoin('/tmp/x', 'a/../../evil')).toBeUndefined()
    expect(safeJoin('/tmp/x', '/etc/passwd')).toBeUndefined()
    expect(safeJoin('/tmp/x', 'C:\\Windows\\evil')).toBeUndefined()
    expect(safeJoin('/tmp/x', '..\\evil')).toBeUndefined()
  })
})

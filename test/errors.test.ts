import { describe, expect, it } from 'vitest'
import { extractFailureCode, isInstallSuccess, mapInstallError } from '../src/main/adb/errors'
import { adbFixture } from './helpers'

describe('isInstallSuccess', () => {
  it('detects success', () => expect(isInstallSuccess(adbFixture('install-success.txt'))).toBe(true))
  it('detects failure', () => expect(isInstallSuccess(adbFixture('install-older-sdk.txt'))).toBe(false))
  it('a Success line plus a Failure is a failure', () => expect(isInstallSuccess('Success\nFailure [X]')).toBe(false))
})

describe('extractFailureCode', () => {
  it('new format with message', () =>
    expect(extractFailureCode(adbFixture('install-deprecated-sdk.txt'))).toEqual({
      code: 'INSTALL_FAILED_DEPRECATED_SDK_VERSION',
      detail: 'App package must target at least SDK version 23, but found 22'
    }))
  it('old format without message', () =>
    expect(extractFailureCode(adbFixture('install-old-format.txt'))).toEqual({ code: 'INSTALL_FAILED_INSUFFICIENT_STORAGE', detail: undefined }))
})

describe('mapInstallError', () => {
  const ctx = { tvSdk: 28, tvAbis: ['armeabi-v7a', 'armeabi'], apkMinSdk: 30, apkTargetSdk: 22, apkAbis: ['arm64-v8a'] }
  it.each([
    ['install-no-matching-abis.txt', 'INSTALL_FAILED_NO_MATCHING_ABIS', /different processor/, undefined],
    ['install-older-sdk.txt', 'INSTALL_FAILED_OLDER_SDK', /too old/, undefined],
    ['install-insufficient-storage.txt', 'INSTALL_FAILED_INSUFFICIENT_STORAGE', /space/, undefined],
    ['install-no-certificates.txt', 'INSTALL_PARSE_FAILED_NO_CERTIFICATES', /signed/, undefined],
    ['install-update-incompatible.txt', 'INSTALL_FAILED_UPDATE_INCOMPATIBLE', /different developer/, 'uninstall_reinstall'],
    ['install-version-downgrade.txt', 'INSTALL_FAILED_VERSION_DOWNGRADE', /older version/, 'uninstall_reinstall'],
    ['install-deprecated-sdk.txt', 'INSTALL_FAILED_DEPRECATED_SDK_VERSION', /old Android version/, 'bypass_low_target_sdk'],
    ['install-test-only.txt', 'INSTALL_FAILED_TEST_ONLY', /test build/, 'allow_test'],
    ['install-missing-split.txt', 'INSTALL_FAILED_MISSING_SPLIT', /missing/, undefined],
    ['install-offline.txt', 'CONNECTION_LOST', /connection/, undefined]
  ])('%s', (file, code, title, remedy) => {
    const f = mapInstallError(adbFixture(file), ctx)
    expect(f.code).toBe(code)
    expect(f.title).toMatch(title)
    expect(f.remedy).toBe(remedy)
    expect(f.fix.length).toBeGreaterThan(10)
  })
  it('uses context in explanations', () => {
    expect(mapInstallError(adbFixture('install-older-sdk.txt'), ctx).explanation).toBe(
      'This app needs at least Android 11 (API 30); your TV runs Android 9 (API 28).'
    )
    expect(mapInstallError(adbFixture('install-no-matching-abis.txt'), ctx).explanation).toMatch(
      /arm64-v8a.*armeabi-v7a, armeabi/
    )
  })
  it('unknown codes are still reported', () => {
    const f = mapInstallError('Failure [INSTALL_FAILED_SOMETHING_NEW: weird]')
    expect(f).toMatchObject({ code: 'INSTALL_FAILED_SOMETHING_NEW', title: 'Android refused the install' })
    expect(f.explanation).toMatch(/weird/)
  })
  it('no code at all', () => expect(mapInstallError('').code).toBe('UNKNOWN'))
})

// Translates `adb install` failures into plain English with a fix. Tested in
// test/errors.test.ts against recorded/representative adb output.

import { androidName } from '@shared/android'
import type { InstallFailure } from '@shared/types'

export interface ErrorContext {
  tvSdk?: number
  tvAbis?: string[]
  apkMinSdk?: number
  apkTargetSdk?: number
  apkAbis?: string[]
  apkSize?: number
  freeBytes?: number
}

/** True if adb's output reports a successful install. */
export function isInstallSuccess(output: string): boolean {
  return /^Success\s*$/m.test(output) && !/Failure \[/.test(output)
}

/** Pulls "INSTALL_FAILED_X" (or similar) and the message after it out of adb output. */
export function extractFailureCode(output: string): { code?: string; detail?: string } {
  const m = /Failure \[([A-Z_]+)(?::\s*([^\]]*))?\]/.exec(output) ?? /\b((?:INSTALL|DELETE)_[A-Z_]+)\b:?\s*(.*)/.exec(output)
  return m ? { code: m[1], detail: m[2]?.trim() || undefined } : {}
}

const list = (a: string[] | undefined): string => (a && a.length ? a.join(', ') : 'unknown')

type Entry = Omit<InstallFailure, 'code' | 'raw'>

function describe(code: string, detail: string | undefined, ctx: ErrorContext): Entry | undefined {
  switch (code) {
    case 'INSTALL_FAILED_NO_MATCHING_ABIS':
      return {
        title: 'Built for a different processor',
        explanation: `This app contains native code for ${list(ctx.apkAbis)}, but your TV’s processor supports ${list(ctx.tvAbis)}.`,
        fix: 'Download the version of the app built for your TV’s processor (usually “armeabi-v7a” or “arm64-v8a”), or a “universal” APK.'
      }
    case 'INSTALL_FAILED_OLDER_SDK':
      return {
        title: 'Your TV’s Android version is too old',
        explanation: `This app needs at least ${androidName(ctx.apkMinSdk)}; your TV runs ${androidName(ctx.tvSdk)}.`,
        fix: 'Look for an older release of the app that supports your TV’s Android version, or check for a system update on the TV (Settings → System → About → System update).'
      }
    case 'INSTALL_FAILED_INSUFFICIENT_STORAGE':
      return {
        title: 'Not enough space on the TV',
        explanation: 'The TV ran out of storage while installing. Installing needs roughly twice the app’s size free.',
        fix: 'Uninstall apps you don’t use (Apps on TV tab), or on the TV go to Settings → Apps and clear the cache of large apps, then try again.'
      }
    case 'INSTALL_PARSE_FAILED_NO_CERTIFICATES':
    case 'INSTALL_PARSE_FAILED_CERTIFICATE_ENCODING':
    case 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES':
      return {
        title: 'The APK isn’t properly signed',
        explanation:
          'Android only installs apps that carry a valid signature. This file has none, or it’s damaged (for example an incomplete download).',
        fix: 'Download the APK again from a trustworthy source. If you built it yourself, sign it (e.g. with apksigner) before installing.'
      }
    case 'INSTALL_FAILED_UPDATE_INCOMPATIBLE':
      return {
        title: 'Signed by a different developer than the installed copy',
        explanation:
          'A version of this app is already on the TV, but it was signed with a different key (for example, it came from the Play Store and this APK came from elsewhere). Android won’t replace it.',
        fix: 'Uninstall the existing app and install this one. This deletes the app’s data and settings on the TV.',
        remedy: 'uninstall_reinstall'
      }
    case 'INSTALL_FAILED_VERSION_DOWNGRADE':
      return {
        title: 'This is an older version than the one installed',
        explanation: 'Android won’t replace an app with an older version.',
        fix: 'Uninstall the newer version first, then install this one. This deletes the app’s data and settings on the TV.',
        remedy: 'uninstall_reinstall'
      }
    case 'INSTALL_FAILED_DEPRECATED_SDK_VERSION':
      return {
        title: 'Blocked because the app targets a very old Android version',
        explanation: `Android 14 and newer refuse apps built for old Android versions${
          ctx.apkTargetSdk ? ` (this one targets ${androidName(ctx.apkTargetSdk)})` : ''
        }, because they skip modern security protections.`,
        fix: 'Prefer a newer release of the app. If you trust this app, you can override the block once.',
        remedy: 'bypass_low_target_sdk'
      }
    case 'INSTALL_FAILED_TEST_ONLY':
      return {
        title: 'This is a test build',
        explanation: 'The developer marked this APK as “test only”. Android installs these only when explicitly allowed.',
        fix: 'If you trust this build, retry with test packages allowed.',
        remedy: 'allow_test'
      }
    case 'INSTALL_FAILED_ALREADY_EXISTS':
      return {
        title: 'The app is already installed',
        explanation: 'Android refused to replace the installed copy.',
        fix: 'Uninstall the existing app first. This deletes its data on the TV.',
        remedy: 'uninstall_reinstall'
      }
    case 'INSTALL_FAILED_MISSING_SPLIT':
      return {
        title: 'Part of the app is missing',
        explanation:
          'This APK is one piece of a split app and needs its other parts (for example its base APK or configuration splits) to be installed together.',
        fix: 'Download the complete bundle (.apks, .xapk or .apkm) and install that instead.'
      }
    case 'INSTALL_FAILED_MISSING_FEATURE':
      return {
        title: 'The TV lacks hardware this app requires',
        explanation: `The app requires a feature your TV doesn’t have${detail ? ` (${detail.replace(/^.*?:\s*/, '')})` : ''}, such as a touchscreen, camera or telephony.`,
        fix: 'This app can’t run on this TV. Look for a TV version of the app.'
      }
    case 'INSTALL_FAILED_MISSING_SHARED_LIBRARY':
      return {
        title: 'The TV lacks a system library this app needs',
        explanation: `The app depends on a system component that isn’t on this TV${detail ? ` (${detail})` : ''}.`,
        fix: 'Look for a version of the app made for Android TV / Google TV.'
      }
    case 'INSTALL_FAILED_CONFLICTING_PROVIDER':
    case 'INSTALL_FAILED_DUPLICATE_PERMISSION':
    case 'INSTALL_FAILED_DUPLICATE_PERMISSION_GROUP':
      return {
        title: 'Conflicts with another installed app',
        explanation: `Another app on the TV already claims something this app needs${detail ? ` (${detail})` : ''}. This often happens with modified copies of an app.`,
        fix: 'Uninstall the other version or variant of this app (check the Apps on TV tab), then try again.'
      }
    case 'INSTALL_FAILED_USER_RESTRICTED':
      return {
        title: 'The TV blocked the install',
        explanation: 'The TV’s settings or a parental/child profile restrict installing apps over adb.',
        fix: 'On the TV, check you’re using the main (not a kids) profile and that no install restriction is enabled, then try again.'
      }
    case 'INSTALL_FAILED_VERIFICATION_FAILURE':
    case 'INSTALL_FAILED_VERIFICATION_TIMEOUT':
      return {
        title: 'Google Play Protect blocked or didn’t confirm the app',
        explanation: 'Play Protect checks apps installed over adb, and it either flagged this app or timed out.',
        fix: 'Look at the TV for a Play Protect message. If you trust the app, choose to install anyway there, then retry. Only do this for apps you trust.'
      }
    case 'INSTALL_FAILED_ABORTED':
      return {
        title: 'The install was cancelled on the TV',
        explanation: 'Someone (or Play Protect) cancelled the install on the TV.',
        fix: 'Retry and watch the TV for a confirmation prompt.'
      }
    case 'INSTALL_FAILED_INVALID_APK':
    case 'INSTALL_PARSE_FAILED_NOT_APK':
    case 'INSTALL_PARSE_FAILED_BAD_MANIFEST':
    case 'INSTALL_PARSE_FAILED_MANIFEST_MALFORMED':
    case 'INSTALL_PARSE_FAILED_MANIFEST_EMPTY':
    case 'INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION':
    case 'INSTALL_PARSE_FAILED_BAD_PACKAGE_NAME':
      return {
        title: 'The APK is damaged or not a valid app',
        explanation: `Android couldn’t read this file${detail ? ` (${detail})` : ''}.`,
        fix: 'Download it again. If it came inside a bundle, install the bundle file rather than a single APK from it.'
      }
    case 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE':
      return {
        title: 'Incompatible with apps already on the TV',
        explanation: 'This app shares data with another app that is signed differently.',
        fix: 'This usually means it’s a system app replacement or a modified build; it can’t be installed on this TV.'
      }
    case 'INSTALL_FAILED_INTERNAL_ERROR':
    case 'INSTALL_FAILED_DEXOPT':
    case 'INSTALL_FAILED_SESSION_INVALID':
    case 'INSTALL_FAILED_MEDIA_UNAVAILABLE':
      return {
        title: 'The TV hit an internal error',
        explanation: `Android reported an internal problem while installing${detail ? ` (${detail})` : ''}.`,
        fix: 'Restart the TV and try again. If it keeps failing, free some storage first.'
      }
    default:
      return undefined
  }
}

/** Non-installer problems: connection lost, file missing, etc. */
function describeTransport(output: string): (Entry & { code: string }) | undefined {
  if (/device offline|device '.*' not found|no devices\/emulators found|closed|connection reset|protocol fault/i.test(output))
    return {
      code: 'CONNECTION_LOST',
      title: 'Lost the connection to the TV',
      explanation: 'The TV stopped responding during the install (it may have gone to sleep or changed network).',
      fix: 'Wake the TV, click Reconnect, and try again.'
    }
  if (/device unauthorized|unauthorized/i.test(output))
    return {
      code: 'UNAUTHORIZED',
      title: 'The TV hasn’t approved this computer',
      explanation: 'adb isn’t allowed to talk to the TV yet.',
      fix: 'Approve “Allow debugging?” on the TV (tick “Always allow from this computer”), then try again.'
    }
  if (/failed to stat|No such file|cannot open|can't find/i.test(output))
    return {
      code: 'FILE_NOT_FOUND',
      title: 'Couldn’t read the file on this computer',
      explanation: 'The file was moved, deleted, or is on a drive that’s no longer available.',
      fix: 'Add the file again.'
    }
  return undefined
}

export function mapInstallError(output: string, ctx: ErrorContext = {}): InstallFailure {
  const raw = output.trim()
  const { code, detail } = extractFailureCode(raw)
  if (code) {
    const d = describe(code, detail, ctx)
    if (d) return { code, raw, ...d }
    return {
      code,
      raw,
      title: 'Android refused the install',
      explanation: `The TV reported ${code}${detail ? `: ${detail}` : ''}.`,
      fix: 'Open Details below for the full output. Searching for this code online usually explains the cause.'
    }
  }
  const t = describeTransport(raw)
  if (t) return { ...t, raw }
  return {
    code: 'UNKNOWN',
    raw,
    title: 'The install didn’t complete',
    explanation: raw ? `adb said: ${raw.split('\n').slice(-1)[0]}` : 'adb gave no output.',
    fix: 'Check the TV is still connected, then try again. The Details log has the full output.'
  }
}

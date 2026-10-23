import { access, constants } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { AdbSource } from '@shared/types'

export interface AdbCandidate {
  path: string
  source: AdbSource
}

export const adbExe = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32' ? 'adb.exe' : 'adb'

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Where to look for adb, in priority order:
 *   1. adb on PATH (what the user already uses)
 *   2. the standard Android SDK location (also Google's official platform-tools)
 *   3. platform-tools the app downloaded into its own data folder
 */
export function candidatePaths(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  appDataPlatformTools: string,
  home: string
): AdbCandidate[] {
  const { isAbsolute, join } = platform === 'win32' ? win32 : posix
  const exe = adbExe(platform)
  const out: AdbCandidate[] = []
  const pathVar = env.PATH ?? env.Path ?? ''
  for (const dir of pathVar.split(platform === 'win32' ? ';' : ':')) {
    const d = dir.trim().replace(/^"|"$/g, '')
    // Ignore relative entries such as "." so a file in the working directory can't impersonate adb.
    if (d && isAbsolute(d)) out.push({ path: join(d, exe), source: 'path' })
  }
  const sdkRoots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]
  if (platform === 'win32' && env.LOCALAPPDATA) sdkRoots.push(join(env.LOCALAPPDATA, 'Android', 'Sdk'))
  if (platform === 'darwin') sdkRoots.push(join(home, 'Library', 'Android', 'sdk'))
  if (platform === 'linux') sdkRoots.push(join(home, 'Android', 'Sdk'))
  for (const root of sdkRoots) if (root) out.push({ path: join(root, 'platform-tools', exe), source: 'android-sdk' })
  out.push({ path: join(appDataPlatformTools, exe), source: 'app-data' })
  return out
}

export async function findAdb(candidates: AdbCandidate[]): Promise<AdbCandidate | undefined> {
  for (const c of candidates) if (await isExecutable(c.path)) return c
  return undefined
}

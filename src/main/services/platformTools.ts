import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Log } from '../log'
import { ZipReader, safeJoin } from '../zip'

/** Google's SDK repository manifest; lists every platform-tools build with its SHA-1. */
export const REPOSITORY_URL = 'https://dl.google.com/android/repository/repository2-3.xml'
export const REPOSITORY_BASE = 'https://dl.google.com/android/repository/'
export const LICENSE_URL = 'https://developer.android.com/studio/releases/platform-tools'

export type HostOs = 'windows' | 'macosx' | 'linux'

export function hostOs(platform: NodeJS.Platform = process.platform): HostOs {
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macosx' : 'linux'
}

export interface PlatformToolsArchive {
  url: string
  sha1?: string
  size?: number
  version?: string
}

/** Fallback when the manifest can't be parsed. Still Google's official download. */
export function latestUrl(os: HostOs): string {
  return `${REPOSITORY_BASE}platform-tools-latest-${os === 'macosx' ? 'darwin' : os}.zip`
}

/**
 * Picks the stable (channel-0) platform-tools archive for `os` from
 * repository2-3.xml. The XML is small and regular, so a focused regex parse
 * avoids an XML dependency.
 */
export function parseRepository(xml: string, os: HostOs): PlatformToolsArchive | undefined {
  const pkgs = [...xml.matchAll(/<remotePackage\s+path="platform-tools">([\s\S]*?)<\/remotePackage>/g)].map((m) => m[1])
  const stable = pkgs.find((p) => /<channelRef\s+ref="channel-0"\s*\/>/.test(p)) ?? pkgs[0]
  if (!stable) return undefined
  const rev = /<revision>([\s\S]*?)<\/revision>/.exec(stable)?.[1] ?? ''
  const part = (tag: string): string | undefined => new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(rev)?.[1]
  const version = [part('major'), part('minor'), part('micro')].filter((x) => x !== undefined).join('.') || undefined
  for (const a of stable.matchAll(/<archive>([\s\S]*?)<\/archive>/g)) {
    const body = a[1]
    if (!new RegExp(`<host-os>${os}</host-os>`).test(body)) continue
    const complete = /<complete>([\s\S]*?)<\/complete>/.exec(body)?.[1] ?? body
    const file = /<url>([^<]+)<\/url>/.exec(complete)?.[1]?.trim()
    if (!file || !/^[\w.-]+\.zip$/.test(file)) continue
    const sha1 = /<checksum(?:\s+type="sha1")?>([0-9a-fA-F]{40})<\/checksum>/.exec(complete)?.[1]?.toLowerCase()
    const size = Number(/<size>(\d+)<\/size>/.exec(complete)?.[1]) || undefined
    return { url: REPOSITORY_BASE + file, sha1, size, version }
  }
  return undefined
}

export interface DownloadDeps {
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
  log: Log
}

export interface DownloadProgress {
  stage: 'manifest' | 'download' | 'verify' | 'extract'
  fraction?: number
}

/**
 * Downloads Google's official platform-tools into `<dataDir>/platform-tools`.
 * Only ever contacts dl.google.com.
 */
export async function downloadPlatformTools(
  dataDir: string,
  deps: DownloadDeps,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const os = hostOs()
  onProgress({ stage: 'manifest' })
  let archive: PlatformToolsArchive | undefined
  try {
    deps.log.add('cmd', `GET ${REPOSITORY_URL}`)
    const res = await deps.fetch(REPOSITORY_URL, { signal })
    if (res.ok) archive = parseRepository(await res.text(), os)
  } catch (e) {
    if (signal?.aborted) throw e
    deps.log.add('err', `Could not read Google’s repository manifest: ${(e as Error).message}`)
  }
  if (!archive) {
    archive = { url: latestUrl(os) }
    deps.log.info('Falling back to the platform-tools "latest" link (no checksum available).')
  }
  assertGoogleUrl(archive.url)

  const tmpZip = join(dataDir, 'platform-tools-download.zip')
  const staging = join(dataDir, 'platform-tools-staging')
  const finalDir = join(dataDir, 'platform-tools')
  await mkdir(dataDir, { recursive: true })
  await rm(staging, { recursive: true, force: true })

  try {
    onProgress({ stage: 'download', fraction: 0 })
    deps.log.add('cmd', `GET ${archive.url}`)
    const res = await deps.fetch(archive.url, { signal })
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
    const total = Number(res.headers.get('content-length')) || archive.size || 0
    const hash = createHash('sha1')
    let received = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk)
        received += chunk.length
        if (total) onProgress({ stage: 'download', fraction: Math.min(1, received / total) })
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(tmpZip), { signal })

    onProgress({ stage: 'verify' })
    const digest = hash.digest('hex')
    if (archive.sha1) {
      if (digest !== archive.sha1) throw new Error('The download is corrupted (checksum mismatch). Please try again.')
      deps.log.info(`SHA-1 verified: ${digest}`)
    } else {
      deps.log.info(`SHA-1 of download: ${digest}`)
    }

    onProgress({ stage: 'extract', fraction: 0 })
    const zip = await ZipReader.open(tmpZip)
    try {
      const files = zip.list().filter((e) => !e.isDirectory && e.name.startsWith('platform-tools/'))
      if (!files.length) throw new Error('The download doesn’t contain platform-tools.')
      let done = 0
      for (const f of files) {
        const target = safeJoin(staging, f.name.slice('platform-tools/'.length))
        if (!target) throw new Error(`Refusing unsafe path in archive: ${f.name}`)
        await zip.extractTo(f.name, target, signal)
        if (process.platform !== 'win32') await chmod(target, 0o755)
        onProgress({ stage: 'extract', fraction: ++done / files.length })
      }
    } finally {
      zip.close()
    }
    await rm(finalDir, { recursive: true, force: true })
    await rename(staging, finalDir)
    return finalDir
  } finally {
    await rm(tmpZip, { force: true })
    await rm(staging, { recursive: true, force: true })
  }
}

function assertGoogleUrl(url: string): void {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.hostname !== 'dl.google.com') throw new Error(`Refusing to download from ${u.host}`)
}

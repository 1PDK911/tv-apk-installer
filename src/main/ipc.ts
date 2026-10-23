import { type BrowserWindow, type IpcMainInvokeEvent, dialog, ipcMain, net, shell } from 'electron'
import { API_METHODS, EVENTS, EXTERNAL_LINKS, type Api, type ApiMethod } from '@shared/api'
import type { ConnectRequest, InstallOptions, PairRequest } from '@shared/types'
import {
  isValidPackageName,
  validateIp,
  validatePairingCode,
  validatePort,
  validateTvName
} from '@shared/validation'
import { Jobs, isJobId } from './jobs'
import type { Log } from './log'
import type { AdbManager } from './services/adbManager'
import type { DeviceService } from './services/devices'
import { downloadPlatformTools } from './services/platformTools'
import type { FileRegistry } from './services/files'
import { Installer } from './services/install'
import { buildPlan, inspectFile } from './services/plans'
import { preflight } from './services/preflight'
import type { Store } from './services/store'

export interface Services {
  adb: AdbManager
  devices: DeviceService
  store: Store
  files: FileRegistry
  log: Log
  dataDir: string
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
  window: () => BrowserWindow | undefined
}

class InputError extends Error {}

function check<T>(v: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!v.ok) throw new InputError(v.error)
  return v.value
}
function str(x: unknown, what: string): string {
  if (typeof x !== 'string' || x.length > 500) throw new InputError(`Invalid ${what}.`)
  return x
}
function job(x: unknown): string {
  if (!isJobId(x)) throw new InputError('Invalid job id.')
  return x
}

type Handlers = { [K in ApiMethod]: (...args: unknown[]) => ReturnType<Api[K]> | Awaited<ReturnType<Api[K]>> } & {
  addFiles: (...args: unknown[]) => ReturnType<Api['pickFiles']>
}

function installOptions(x: unknown): InstallOptions {
  const o = (x ?? {}) as Record<string, unknown>
  return { uninstallFirst: o.uninstallFirst === true, bypassLowTargetSdk: o.bypassLowTargetSdk === true, allowTest: o.allowTest === true }
}

export function registerIpc(s: Services): void {
  const jobs = new Jobs()
  const send = (channel: string, payload: unknown): void => {
    const w = s.window()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  s.log.subscribe((e) => send(EVENTS.log, e))

  const handlers: Handlers = {
    adbStatus: () => s.adb.getStatus(),
    adbRecheck: async () => {
      const st = await s.adb.detect()
      if (st.found) void s.devices.reconnectAll()
      return st
    },
    downloadPlatformTools: async (jobId) => {
      const id = job(jobId)
      try {
        await jobs.run(id, (signal) =>
          downloadPlatformTools(
            s.dataDir,
            { fetch: (url, init) => net.fetch(url, init), log: s.log },
            (p) =>
              send(EVENTS.progress, {
                jobId: id,
                stage: {
                  manifest: 'Checking Google’s download index…',
                  download: 'Downloading platform-tools from dl.google.com…',
                  verify: 'Verifying download…',
                  extract: 'Unpacking…'
                }[p.stage],
                fraction: p.fraction
              }),
            signal
          )
        )
      } catch (e) {
        return { ok: false, message: (e as Error).name === 'AbortError' ? 'Download cancelled.' : (e as Error).message }
      }
      const status = await s.adb.detect()
      if (!status.found) return { ok: false, message: `Downloaded, but adb didn’t run: ${status.error ?? 'unknown error'}`, status }
      void s.devices.reconnectAll()
      return { ok: true, message: `adb ${status.version} is ready.`, status }
    },

    listTvs: () => s.devices.list(),
    discover: () => s.devices.discover(),
    pair: async (jobId, raw) => {
      const r = (raw ?? {}) as Partial<PairRequest>
      const req: PairRequest = {
        ip: check(validateIp(r.ip)),
        pairingPort: check(validatePort(r.pairingPort)),
        code: check(validatePairingCode(r.code)),
        connectPort: check(validatePort(r.connectPort)),
        name: check(validateTvName(r.name))
      }
      return jobs.run(job(jobId), (signal) => s.devices.pair(req, signal))
    },
    connect: async (jobId, raw) => {
      const r = (raw ?? {}) as Partial<ConnectRequest>
      if (r.method !== 'wireless' && r.method !== 'classic') throw new InputError('Invalid method.')
      const req: ConnectRequest = {
        ip: check(validateIp(r.ip)),
        port: check(validatePort(r.port)),
        method: r.method,
        name: check(validateTvName(r.name))
      }
      return jobs.run(job(jobId), (signal) => s.devices.connect(req, signal))
    },
    reconnect: (jobId, tvId) => jobs.run(job(jobId), (signal) => s.devices.connectTv(str(tvId, 'TV'), signal)),
    disconnect: (tvId) => s.devices.disconnect(str(tvId, 'TV')),
    forget: (tvId) => s.devices.forget(str(tvId, 'TV')),
    renameTv: (tvId, name) => s.devices.rename(str(tvId, 'TV'), check(validateTvName(name))),
    setTvPort: (jobId, tvId, ip, port) => {
      const id = job(jobId)
      const tv = str(tvId, 'TV')
      const vip = check(validateIp(ip))
      const vport = check(validatePort(port))
      return jobs.run(id, () => s.devices.setPort(tv, vip, vport))
    },
    refreshInfo: async (tvId) => {
      const id = str(tvId, 'TV')
      await s.devices.loadInfo(id)
      return s.devices.list().find((t) => t.id === id)
    },
    selectTv: async (tvId) => {
      const id = tvId === null ? undefined : str(tvId, 'TV')
      await s.store.update((d) => {
        d.selectedTvId = id
      })
    },
    getSelectedTv: () => s.store.get().selectedTvId ?? null,

    pickFiles: async () => {
      const w = s.window()
      const opts = {
        title: 'Choose apps to install',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
        filters: [
          { name: 'Android apps', extensions: ['apk', 'apks', 'xapk', 'apkm'] },
          { name: 'All files', extensions: ['*'] }
        ]
      }
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? { added: [], rejected: [] } : s.files.add(r.filePaths)
    },
    addFiles: (paths) => s.files.add(paths),
    removeFile: (fileId) => s.files.remove(fileId),
    inspect: async (jobId, fileId, tvId) => {
      const file = s.files.get(fileId)
      if (!file) throw new InputError('That file is no longer in the queue.')
      const target = tvId === null ? undefined : s.devices.requireConnected(str(tvId, 'TV'))
      const connected = target && !('error' in target) ? target : undefined
      return jobs.run(job(jobId), async (signal) => {
        let info
        try {
          info = await inspectFile(file, connected?.tv.info, signal)
        } catch (e) {
          return { checks: [], error: (e as Error).message }
        }
        if (!connected) return { info, checks: [] }
        const adb = s.adb.client()
        const pkg = adb
          ? await new Installer(adb, s.log).installedPackage(connected.serial, info.packageName, signal).catch(() => undefined)
          : undefined
        const installed = { installed: !!pkg, versionName: pkg?.versionName, versionCode: pkg?.versionCode }
        return { info, installed, checks: preflight(info, connected.tv.info, installed) }
      })
    },
    install: async (jobId, fileId, tvId, options) => {
      const id = job(jobId)
      const file = s.files.get(fileId)
      if (!file) throw new InputError('That file is no longer in the queue.')
      const target = s.devices.requireConnected(str(tvId, 'TV'))
      if ('error' in target) return { ok: false, message: target.error }
      const adb = s.adb.client()
      if (!adb) return { ok: false, message: 'adb isn’t set up yet.' }
      const opts = installOptions(options)
      const progress = (steps: string[], stepIndex: number, detail?: string): void =>
        send(EVENTS.progress, { jobId: id, stage: steps[stepIndex], steps, stepIndex, detail })
      return jobs.run(id, async (signal) => {
        progress(['Preparing'], 0)
        let planned
        try {
          planned = await buildPlan(file, target.tv.info)
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
        try {
          s.log.info(`Installing ${file.name} (${planned.plan.packageName}) on ${target.tv.name}`)
          const result = await new Installer(adb, s.log).install(target.serial, planned.plan, opts, progress, signal)
          if (result.ok) void s.devices.loadInfo(target.tv.id) // free storage changed
          return result
        } finally {
          await planned.cleanup()
        }
      })
    },
    launchApp: async (tvId, pkg) => {
      const target = s.devices.requireConnected(str(tvId, 'TV'))
      if ('error' in target) return { ok: false, message: target.error }
      if (!isValidPackageName(pkg)) throw new InputError('Invalid package name.')
      const adb = s.adb.client()
      if (!adb) return { ok: false, message: 'adb isn’t set up yet.' }
      return new Installer(adb, s.log).launch(target.serial, pkg)
    },

    cancelJob: (jobId) => jobs.cancel(job(jobId)),
    getLog: () => s.log.all(),
    clearLog: () => s.log.clear(),
    openExternal: async (url) => {
      const u = str(url, 'link')
      if (!(EXTERNAL_LINKS as readonly string[]).includes(u)) throw new InputError('Link not allowed.')
      await shell.openExternal(u)
    },
    getSetupGuideSeen: () => !!s.store.get().setupGuideSeen,
    setSetupGuideSeen: async () => {
      await s.store.update((d) => {
        d.setupGuideSeen = true
      })
    }
  }

  for (const method of API_METHODS) {
    const fn = (handlers as Record<string, unknown>)[method] as (...args: unknown[]) => unknown
    ipcMain.handle(`api:${method}`, async (event, ...args) => {
      if (!s.isTrustedSender(event)) throw new Error('Untrusted sender')
      try {
        return await fn(...args)
      } catch (e) {
        // Input errors carry a user-facing message; everything else is logged.
        if (!(e instanceof InputError)) s.log.add('err', `${method}: ${(e as Error).stack ?? e}`)
        throw e
      }
    })
  }
}

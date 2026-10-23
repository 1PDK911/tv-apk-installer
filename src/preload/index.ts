import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { API_METHODS, EVENTS, type Api } from '@shared/api'

const api: Record<string, unknown> = {}
for (const method of API_METHODS) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke(`api:${method}`, ...args)
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Electron no longer exposes File.path; resolve dropped files to paths here.
api.addDroppedFiles = (files: File[]) =>
  ipcRenderer.invoke(
    'api:addFiles',
    Array.from(files)
      .map((f) => webUtils.getPathForFile(f))
      .filter(Boolean)
  )
delete api.addFiles

api.onTvs = (cb: Parameters<Api['onTvs']>[0]) => subscribe(EVENTS.tvs, cb)
api.onLog = (cb: Parameters<Api['onLog']>[0]) => subscribe(EVENTS.log, cb)
api.onProgress = (cb: Parameters<Api['onProgress']>[0]) => subscribe(EVENTS.progress, cb)

contextBridge.exposeInMainWorld('api', api as unknown as Api)

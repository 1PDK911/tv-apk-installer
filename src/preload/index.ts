import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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

api.onTvs = (cb: Parameters<Api['onTvs']>[0]) => subscribe(EVENTS.tvs, cb)
api.onLog = (cb: Parameters<Api['onLog']>[0]) => subscribe(EVENTS.log, cb)
api.onProgress = (cb: Parameters<Api['onProgress']>[0]) => subscribe(EVENTS.progress, cb)

contextBridge.exposeInMainWorld('api', api as unknown as Api)

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, Menu, app, session, type IpcMainInvokeEvent } from 'electron'
import { EVENTS } from '@shared/api'
import { buildCsp } from '@shared/csp'
import { registerIpc } from './ipc'
import { Log } from './log'
import { AdbManager } from './services/adbManager'
import { DeviceService } from './services/devices'
import { FileRegistry } from './services/files'
import { Store } from './services/store'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const POLL_MS = 4000

const CSP = buildCsp(isDev)

let mainWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'TV APK Installer',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev
    }
  })
  win.once('ready-to-show', () => win.show())

  // Never navigate away from the app or open new windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!)
  return url.startsWith('file://') && e.sender === mainWindow?.webContents
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
    })
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    // No spellchecker: on some platforms it would download dictionaries from Google.
    session.defaultSession.setSpellCheckerEnabled(false)

    const dataDir = app.getPath('userData')
    // Leftovers from an interrupted bundle install.
    await rm(join(dataDir, 'tmp'), { recursive: true, force: true }).catch(() => undefined)
    const log = new Log()
    const store = new Store(join(dataDir, 'settings.json'))
    await store.load()
    const adb = new AdbManager(dataDir, log)
    const devices = new DeviceService(
      () => adb.client(),
      store,
      log,
      (tvs) => mainWindow?.webContents.send(EVENTS.tvs, tvs)
    )
    registerIpc({ adb, devices, store, files: new FileRegistry(), log, dataDir, isTrustedSender, window: () => mainWindow })

    mainWindow = createWindow()
    mainWindow.on('closed', () => (mainWindow = undefined))

    const status = await adb.detect()
    if (status.found) void devices.reconnectAll()

    let polling = false
    setInterval(async () => {
      if (polling || !adb.client()) return
      polling = true
      try {
        await devices.refresh()
      } finally {
        polling = false
      }
    }, POLL_MS)

    let quitting = false
    app.on('before-quit', (e) => {
      if (quitting) return
      quitting = true
      e.preventDefault()
      void Promise.allSettled([adb.shutdown(), rm(join(dataDir, 'tmp'), { recursive: true, force: true })]).finally(() => app.quit())
    })
  })

  app.on('window-all-closed', () => app.quit())

  // Block any webview or unexpected window creation app-wide.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

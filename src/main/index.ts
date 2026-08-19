import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import { join, basename, dirname } from 'node:path'
import { promises as fsp, watch as fsWatch, existsSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { buildMenu } from './menu'
import { getSettings, setSettings, addRecent } from './store'
import * as ai from './ai'
import * as secrets from './secrets'
import { transcribe as transcribeAudio } from './transcribe'
import { NATIVE_EXTS, TEXT_EXTS, DOCUMENT_EXTS, IMAGE_EXTS, CONVERTIBLE_EXTS, isConvertible } from '../shared/formats'
import { APP_ASCII_NAME, APP_DISPLAY_NAME, APP_ID } from '../shared/brand'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let watcher: FSWatcher | null = null
let pendingOpenPath: string | null = null
/** In-flight transcription jobs, so the UI can cancel a long one. */
const transcribeJobs = new Map<string, AbortController>()

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

const READABLE_EXTS = TEXT_EXTS

function extOf(p: string): string {
  const m = /\.([^.\\/]+)$/.exec(p)
  return m ? m[1].toLowerCase() : ''
}

/* ------------------------------------------------------------------ window */

function createWindow(): void {
  const s = getSettings()
  const b = s.windowBounds

  mainWindow = new BrowserWindow({
    width: b?.width ?? 1280,
    height: b?.height ?? 860,
    x: b?.x,
    y: b?.y,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff',
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })

  if (b?.maximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (process.env['MARKNOTE_SMOKE'] === '1' && mainWindow) {
      const win = mainWindow
      import('./smoke')
        .then((m) => m.runSmoke(win, join(app.getAppPath(), 'out', 'smoke')))
        .catch((err) => {
          // Without this the harness fails silently and looks like a hang.
          console.error('[smoke] harness failed to start:', err)
          app.exit(1)
        })
      return
    }
    if (pendingOpenPath) {
      openPathInRenderer(pendingOpenPath)
      pendingOpenPath = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-page navigation (drag & drop of files onto the window, stray links)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  mainWindow.on('close', (e) => {
    if (!mainWindow) return
    const bounds = mainWindow.getNormalBounds()
    setSettings({
      windowBounds: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: mainWindow.isMaximized()
      }
    })
    // Ask the renderer whether it is safe to quit (unsaved changes prompt).
    if (!(mainWindow as BrowserWindow & { __forceClose?: boolean }).__forceClose) {
      e.preventDefault()
      mainWindow.webContents.send('app:before-close')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    stopWatching()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  buildMenu(mainWindow, (action, payload) => mainWindow?.webContents.send('menu:action', { action, payload }))
}

function send(channel: string, payload?: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

async function openPathInRenderer(filePath: string): Promise<void> {
  try {
    const content = await fsp.readFile(filePath, 'utf8')
    addRecent(filePath)
    if (mainWindow) buildMenu(mainWindow, (a, p) => mainWindow?.webContents.send('menu:action', { action: a, payload: p }))
    watchFile(filePath)
    send('file:opened', { filePath, content })
  } catch (err) {
    dialog.showErrorBox('Could not open file', String((err as Error).message ?? err))
  }
}

/**
 * Reads a file if MarkNote can display it directly, otherwise tells the
 * renderer that conversion is needed. `offerConversion` marks files we *can*
 * show but that usually render better once converted (plain .txt in
 * particular, whose indentation Markdown would treat as code blocks).
 */
async function readOrOfferConversion(filePath: string): Promise<{
  ok: boolean
  filePath?: string
  content?: string
  needsConversion?: boolean
  offerConversion?: boolean
  ext?: string
  error?: string
}> {
  const ext = extOf(filePath)
  const settings = getSettings()

  if (!READABLE_EXTS.includes(ext)) {
    if (isConvertible(filePath)) {
      return { ok: true, filePath, needsConversion: true, ext }
    }
    return {
      ok: false,
      error: `MarkNote cannot open .${ext} files, and the converter does not support that format either.`
    }
  }

  try {
    const content = await fsp.readFile(filePath, 'utf8')
    addRecent(filePath)
    if (mainWindow) buildMenu(mainWindow, (a, p) => send('menu:action', { action: a, payload: p }))
    watchFile(filePath)
    const indented = /^([ ]{4}|\t)\S/m.test(content)
    return {
      ok: true,
      filePath,
      content,
      ext,
      // Only nag when conversion would actually change something.
      offerConversion:
        !NATIVE_EXTS.includes(ext) && indented && settings.convertOnOpen !== 'never'
    }
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) }
  }
}

/* ----------------------------------------------------------------- watcher */

function stopWatching(): void {
  try {
    watcher?.close()
  } catch {
    /* ignore */
  }
  watcher = null
}

function watchFile(filePath: string): void {
  stopWatching()
  try {
    let timer: NodeJS.Timeout | null = null
    watcher = fsWatch(filePath, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => send('file:changed-on-disk', { filePath }), 250)
    })
  } catch {
    /* file may be on a volume that does not support watching */
  }
}

/* ------------------------------------------------------------------- print */

async function renderInHiddenWindow(html: string): Promise<BrowserWindow> {
  const tmp = join(tmpdir(), `marknote-print-${Date.now()}.html`)
  await fsp.writeFile(tmp, html, 'utf8')
  const w = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, javascript: false }
  })
  await w.loadFile(tmp)
  // Give the layout engine a beat to settle fonts/images before printing.
  await new Promise((r) => setTimeout(r, 350))
  ;(w as BrowserWindow & { __tmp?: string }).__tmp = tmp
  return w
}

async function disposeHidden(w: BrowserWindow): Promise<void> {
  const tmp = (w as BrowserWindow & { __tmp?: string }).__tmp
  if (!w.isDestroyed()) w.destroy()
  if (tmp) await fsp.unlink(tmp).catch(() => undefined)
}

/* ------------------------------------------------------------------- ipc */

function registerIpc(): void {
  ipcMain.handle('dialog:open', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open document',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown & text', extensions: READABLE_EXTS },
        { name: 'Convertible documents', extensions: CONVERTIBLE_EXTS },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    return readOrOfferConversion(r.filePaths[0])
  })

  ipcMain.handle('file:read', async (_e: IpcMainInvokeEvent, filePath: string) =>
    readOrOfferConversion(filePath)
  )

  ipcMain.handle('file:save', async (_e, args: { filePath: string | null; content: string; saveAs?: boolean }) => {
    let target = args.filePath
    if (!target || args.saveAs) {
      const r = await dialog.showSaveDialog(mainWindow!, {
        title: args.saveAs ? 'Save a copy as' : 'Save Markdown file',
        defaultPath: target ?? join(app.getPath('documents'), 'Untitled.md'),
        filters: MD_FILTERS
      })
      if (r.canceled || !r.filePath) return { ok: false, canceled: true }
      target = r.filePath
      if (!/\.[a-z0-9]+$/i.test(target)) target += '.md'
    }
    try {
      stopWatching()
      await fsp.writeFile(target, args.content, 'utf8')
      addRecent(target)
      if (mainWindow) buildMenu(mainWindow, (a, p) => send('menu:action', { action: a, payload: p }))
      watchFile(target)
      return { ok: true, filePath: target }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('file:exportHtml', async (_e, args: { html: string; suggestedName: string }) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export as HTML',
      defaultPath: args.suggestedName.replace(/\.[^.]+$/, '') + '.html',
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      await fsp.writeFile(r.filePath, args.html, 'utf8')
      return { ok: true, filePath: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('file:exportMarkdown', async (_e, args: { text: string; suggestedName: string }) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Markdown without annotations',
      defaultPath: args.suggestedName.replace(/\.[^.]+$/, '') + '-clean.md',
      filters: MD_FILTERS
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      await fsp.writeFile(r.filePath, args.text, 'utf8')
      return { ok: true, filePath: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('file:exportPdf', async (_e, args: { html: string; suggestedName: string }) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export as PDF',
      defaultPath: args.suggestedName.replace(/\.[^.]+$/, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    let w: BrowserWindow | null = null
    try {
      w = await renderInHiddenWindow(args.html)
      const data = await w.webContents.printToPDF({
        printBackground: true,
        margins: { marginType: 'default' },
        pageSize: 'A4'
      })
      await fsp.writeFile(r.filePath, data)
      return { ok: true, filePath: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    } finally {
      if (w) await disposeHidden(w)
    }
  })

  ipcMain.handle('file:print', async (_e, args: { html: string }) => {
    let w: BrowserWindow | null = null
    try {
      w = await renderInHiddenWindow(args.html)
      const target = w
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        target.webContents.print({ printBackground: true, silent: false }, (success, reason) =>
          resolve({ ok: success, error: success ? undefined : reason })
        )
      })
      return result
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    } finally {
      if (w) await disposeHidden(w)
    }
  })

  ipcMain.handle('find:start', (_e, args: { text: string; forward?: boolean; findNext?: boolean }) => {
    if (!args.text) return { ok: false }
    mainWindow?.webContents.findInPage(args.text, {
      forward: args.forward ?? true,
      findNext: args.findNext ?? false,
      matchCase: false
    })
    return { ok: true }
  })

  ipcMain.handle('find:stop', () => {
    mainWindow?.webContents.stopFindInPage('clearSelection')
    return { ok: true }
  })

  ipcMain.handle('settings:get', () => {
    // Never hand raw credentials to the renderer; expose presence only.
    const s = getSettings()
    return {
      ...s,
      aiKeys: {
        anthropic: secrets.has(s.aiKeys.anthropic) ? '__saved__' : '',
        openai: secrets.has(s.aiKeys.openai) ? '__saved__' : '',
        gemini: secrets.has(s.aiKeys.gemini) ? '__saved__' : ''
      }
    }
  })

  ipcMain.handle('settings:set', (_e, patch: Record<string, unknown>) => {
    // Guard against the renderer overwriting stored keys with the placeholder.
    if (patch.aiKeys) delete patch.aiKeys
    return setSettings(patch)
  })

  /* ------------------------------------------------------------------ AI */

  ipcMain.handle('ai:status', (_e, provider: ai.ProviderId) => ai.status(provider))
  ipcMain.handle('ai:models', (_e, provider: ai.ProviderId) => ai.listModels(provider))
  ipcMain.handle('ai:chat', (_e, req: ai.ChatRequest) => ai.chat(req))

  ipcMain.handle('ai:keyState', () => {
    const keys = getSettings().aiKeys
    return {
      encryption: secrets.isEncryptionAvailable(),
      anthropic: { saved: secrets.has(keys.anthropic), hint: secrets.hint(keys.anthropic) },
      openai: { saved: secrets.has(keys.openai), hint: secrets.hint(keys.openai) },
      gemini: { saved: secrets.has(keys.gemini), hint: secrets.hint(keys.gemini) },
      assemblyai: { saved: secrets.has(keys.assemblyai), hint: secrets.hint(keys.assemblyai) }
    }
  })

  ipcMain.handle('ai:setKey', (_e, args: { provider: 'anthropic' | 'openai' | 'gemini' | 'assemblyai'; key: string }) => {
    const keys = { ...getSettings().aiKeys }
    keys[args.provider] = args.key ? secrets.seal(args.key.trim()) : ''
    setSettings({ aiKeys: keys })
    return { ok: true, encrypted: secrets.isEncryptionAvailable() }
  })

  /* ----------------------------------------------------------- converter */

  ipcMain.handle('convert:pickInput', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose documents to convert to Markdown',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All supported', extensions: CONVERTIBLE_EXTS },
        { name: 'Documents', extensions: DOCUMENT_EXTS },
        { name: 'Text & data', extensions: TEXT_EXTS },
        { name: 'Images', extensions: IMAGE_EXTS },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true }
    return { ok: true, filePaths: r.filePaths }
  })

  /** Raw bytes for the renderer-side converters. Arrives as a Uint8Array. */
  ipcMain.handle('file:readBytes', async (_e, filePath: string) => {
    try {
      const data = await fsp.readFile(filePath)
      return { ok: true, bytes: new Uint8Array(data), name: basename(filePath) }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('file:writeText', async (_e, args: { filePath: string; text: string }) => {
    try {
      await fsp.mkdir(dirname(args.filePath), { recursive: true })
      await fsp.writeFile(args.filePath, args.text, 'utf8')
      return { ok: true, filePath: args.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('file:exists', (_e, filePath: string) => existsSync(filePath))

  /**
   * Cloud OCR. Runs here so the Gemini key never reaches renderer code — the
   * same key the AI panel uses, stored encrypted.
   */
  ipcMain.handle('ocr:cloud', async (_e, args: { bytes: Uint8Array; mimeType: string }) => {
    const key = secrets.open(getSettings().aiKeys.gemini)
    if (!key) return { ok: false, code: 'NO_KEY', error: 'No Google Gemini API key has been saved.' }
    return ai.visionOcr(key, Buffer.from(args.bytes).toString('base64'), args.mimeType)
  })

  /**
   * Audio transcription. Cloud-only by necessity; progress is streamed back so
   * the user can see it is alive during a long job, and it can be cancelled.
   */
  ipcMain.handle('transcribe:audio', async (_e, args: { bytes: Uint8Array; jobId: string }) => {
    const controller = new AbortController()
    transcribeJobs.set(args.jobId, controller)
    try {
      return await transcribeAudio(
        new Uint8Array(args.bytes),
        (message, fraction) => send('transcribe:progress', { jobId: args.jobId, message, fraction }),
        controller.signal
      )
    } finally {
      transcribeJobs.delete(args.jobId)
    }
  })

  ipcMain.handle('transcribe:cancel', (_e, jobId: string) => {
    transcribeJobs.get(jobId)?.abort()
    return { ok: true }
  })

  ipcMain.handle('convert:pickOutput', async (_e, args: { suggestedName: string }) => {
    const dir = getSettings().convertDir
    const r = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save converted Markdown as',
      defaultPath: join(dir && existsSync(dir) ? dir : app.getPath('documents'), args.suggestedName),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    let target = r.filePath
    if (!/\.md$/i.test(target)) target += '.md'
    return { ok: true, filePath: target, dir: dirname(target) }
  })

  ipcMain.handle('convert:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose the default folder for converted files',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getSettings().convertDir ?? app.getPath('documents')
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, dir: r.filePaths[0] }
  })

  ipcMain.handle('convert:suggestDir', (_e, args: { input?: string }) => {
    const settings = getSettings()
    if (settings.convertDir && existsSync(settings.convertDir)) return settings.convertDir
    if (args?.input) return dirname(args.input)
    return app.getPath('documents')
  })

  ipcMain.handle('dialog:confirmUnsaved', async (_e, args: { name: string }) => {
    const r = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `Do you want to save the changes you made to ${args.name}?`,
      detail: "Your changes will be lost if you don't save them."
    })
    return ['save', 'discard', 'cancel'][r.response]
  })

  ipcMain.handle('dialog:confirm', async (_e, args: { title: string; message: string; detail?: string }) => {
    const r = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Yes', 'No'],
      defaultId: 1,
      cancelId: 1,
      title: args.title,
      message: args.message,
      detail: args.detail
    })
    return r.response === 0
  })

  ipcMain.handle('dialog:message', async (_e, args: { type?: string; title: string; message: string; detail?: string }) => {
    await dialog.showMessageBox(mainWindow!, {
      type: (args.type as 'info') ?? 'info',
      title: args.title,
      message: args.message,
      detail: args.detail,
      buttons: ['OK']
    })
    return true
  })

  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Insert image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, filePath: r.filePaths[0] }
  })

  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  ipcMain.handle('app:setTitle', (_e, args: { filePath: string | null; dirty: boolean }) => {
    const name = args.filePath ? basename(args.filePath) : 'Untitled'
    mainWindow?.setTitle(`${args.dirty ? '• ' : ''}${name} — ${APP_DISPLAY_NAME}`)
    if (args.filePath) mainWindow?.setRepresentedFilename?.(args.filePath)
    return true
  })

  ipcMain.handle('app:forceClose', () => {
    if (mainWindow) {
      ;(mainWindow as BrowserWindow & { __forceClose?: boolean }).__forceClose = true
      mainWindow.close()
    }
    return true
  })

  ipcMain.handle('path:dirname', (_e, p: string) => dirname(p))
  ipcMain.handle('path:basename', (_e, p: string) => basename(p))
}

/* ------------------------------------------------------------- app lifecycle */

function fileFromArgv(argv: string[]): string | null {
  const candidates = argv.slice(1).filter((a) => !a.startsWith('--') && /\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(a))
  return candidates[0] ?? null
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (f) openPathInRenderer(f)
    }
  })

  app.on('open-file', (e, path) => {
    e.preventDefault()
    if (mainWindow) openPathInRenderer(path)
    else pendingOpenPath = path
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    app.setName(APP_DISPLAY_NAME)
    // The display name contains a superscript ²; keep the settings folder ASCII
    // so no tool trips over a Unicode path.
    app.setPath('userData', join(app.getPath('appData'), APP_ASCII_NAME))
    registerIpc()
    pendingOpenPath = fileFromArgv(process.argv)
    createWindow()

    nativeTheme.on('updated', () => send('theme:system-changed', nativeTheme.shouldUseDarkColors))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

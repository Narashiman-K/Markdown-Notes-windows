import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme, protocol, net, session, type IpcMainInvokeEvent } from 'electron'
import { join, basename, dirname, extname, isAbsolute, normalize, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { promises as fsp, watch as fsWatch, existsSync, rmSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { AsyncLocalStorage } from 'node:async_hooks'
import { buildMenu } from './menu'
import { cloudFolders } from './cloud-folders'
import { getSettings, setSettings, addRecent, clearRecent } from './store'
import * as ai from './ai'
import * as secrets from './secrets'
import { transcribe as transcribeAudio } from './transcribe'
import { NATIVE_EXTS, TEXT_EXTS, DOCUMENT_EXTS, IMAGE_EXTS, CONVERTIBLE_EXTS, isConvertible } from '../shared/formats'
import { APP_ASCII_NAME, APP_DISPLAY_NAME, APP_ID, STORE_REVIEW_URL } from '../shared/brand'

const isDev = !app.isPackaged
/** Where the app's own pages are served from in a built app (registerAppProtocol). */
const APP_SCHEME = 'suprasuta'
const APP_HOST = 'app'
/*
 * Several windows, one per open document, all in this one process.
 *
 * Until November 2026 there was a single window, and opening a .md file from
 * Explorer while the app was running loaded it into that window straight
 * away, without asking about unsaved changes: whatever was being edited was
 * lost. Now each window is its own document, the user chooses where a file
 * from Explorer opens (chooseWhereToOpen), and everything below that used to
 * mean "the window" now means the window that asked.
 */
const windows = new Set<BrowserWindow>()
let lastFocused: BrowserWindow | null = null
/** The window whose request is being handled, for code reached from IPC. */
const senderWindow = new AsyncLocalStorage<BrowserWindow | null>()

/**
 * The window an action is for: the one whose request is being handled, else
 * the focused document window, else the one used last.
 */
function currentWindow(): BrowserWindow | null {
  const fromIpc = senderWindow.getStore()
  if (fromIpc && !fromIpc.isDestroyed()) return fromIpc
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && windows.has(focused)) return focused
  if (lastFocused && !lastFocused.isDestroyed()) return lastFocused
  return [...windows][0] ?? null
}

/** Per window (by id): the file it shows, its watcher, a file waiting to load. */
const windowFiles = new Map<number, string>()
const watchers = new Map<number, FSWatcher>()
const pendingOpen = new Map<number, string>()
let pendingOpenPath: string | null = null
let harnessStarted = false
/** In-flight transcription jobs, so the UI can cancel a long one. */
const transcribeJobs = new Map<string, AbortController>()

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

const READABLE_EXTS = TEXT_EXTS

/*
 * `mn-local:` — how the window shows images that live on this computer.
 *
 * The renderer rewrites an on-screen `<img src="file:///…">` to
 * `mn-local://image/?src=<the file URL>` (see setLocalImageResolver in
 * lib/markdown.ts). A `file:` image cannot load into the development build's
 * http page at all, and in the installed app it only loads because the page
 * happens to be on `file:` too — a privilege the planned Electron hardening
 * takes away. A scheme of the app's own works the same way in both.
 *
 * It has to be declared privileged before the app is ready, which is why this
 * runs at module load rather than inside whenReady.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'mn-local', privileges: { standard: true, secure: true, stream: true } },
  // The app's own pages (see registerAppProtocol). Fetch, because pdf.js,
  // Tesseract and the spreadsheet worker load their files with it.
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }
])

/**
 * What `mn-local:` will hand back: images, and nothing else.
 *
 * A document can come from anywhere, and it chooses which paths it asks for,
 * so the scheme is not a general file server. Anything that is not an image by
 * extension is refused before the disk is touched. The renderer's CSP allows
 * the scheme in `img-src` only, so even an image cannot be fetched and read
 * by script — it can only be drawn.
 */
const LOCAL_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])

function registerLocalImageProtocol(): void {
  protocol.handle('mn-local', async (request) => {
    try {
      const src = new URL(request.url).searchParams.get('src') ?? ''
      const target = new URL(src)
      if (target.protocol !== 'file:') return new Response('Only local files are served.', { status: 400 })
      const path = fileURLToPath(target)
      if (!LOCAL_IMAGE_EXTS.has(extname(path).slice(1).toLowerCase())) {
        return new Response('Only images are served.', { status: 403 })
      }
      return await net.fetch(pathToFileURL(path).toString())
    } catch {
      return new Response('Not found.', { status: 404 })
    }
  })
}

/** Locates the app icon in both the development tree and a packaged build. */
function appIconPath(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(app.getAppPath(), '..', 'build', 'icon.ico')
  ]
  return candidates.find((p) => existsSync(p))
}

function extOf(p: string): string {
  const m = /\.([^.\\/]+)$/.exec(p)
  return m ? m[1].toLowerCase() : ''
}

/*
 * The app's own pages, served from `suprasuta://app/` instead of `file://`.
 *
 * A page on `file://` is treated by Chromium as able to reach other local
 * files, which is why Phase 2 had to leave the grantFileProtocolExtraPrivileges
 * fuse on. Served from a scheme of its own, the page has an ordinary origin:
 * its CSP's 'self' means this app's files and nothing else on disk, and the
 * fuse can go off. The handler serves only files inside the built renderer
 * folder; anything that resolves outside it is refused, however the path is
 * written.
 */
function registerAppProtocol(): void {
  const root = normalize(join(__dirname, '../renderer'))
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== APP_HOST) return new Response('Not found.', { status: 404 })
      const target = normalize(join(root, decodeURIComponent(url.pathname)))
      if (target !== root && !target.startsWith(root + sep)) return new Response('Forbidden.', { status: 403 })
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('Not found.', { status: 404 })
    }
  })
}

/*
 * Rules for every window and frame the app creates, including the hidden
 * ones used for printing:
 *  - no <webview>: nothing in the app uses one, and it would be a way to load
 *    a page with its own preferences;
 *  - permissions (camera, microphone, location, notifications, MIDI…) are
 *    refused; the app needs none. Writing to the clipboard and going full
 *    screen are the only ones allowed.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

function hardenSessions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/* ------------------------------------------------------------------ window */

function createWindow(openPath?: string): BrowserWindow {
  const s = getSettings()
  const b = s.windowBounds

  // A new window opens a little down and right of the one in front.
  const front = windows.size ? currentWindow() : null
  const offset = front ? front.getBounds() : null

  const win = new BrowserWindow({
    width: b?.width ?? 1280,
    height: b?.height ?? 860,
    x: offset ? offset.x + 32 : b?.x,
    y: offset ? offset.y + 32 : b?.y,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff',
    title: APP_DISPLAY_NAME,
    // Without this the window and taskbar show Electron's default icon during
    // development. The packaged executable carries the icon itself, but setting
    // it here makes both builds consistent.
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium's sandbox around the page. The preload uses only the parts
      // of Electron a sandboxed preload may (contextBridge, ipcRenderer,
      // webUtils); everything touching the disk is in this process.
      sandbox: true,
      spellcheck: true
    }
  })

  const winId = win.id
  const isFirstWindow = !harnessStarted
  harnessStarted = true
  windows.add(win)
  lastFocused = win
  win.on('focus', () => {
    lastFocused = win
  })
  if (openPath) pendingOpen.set(winId, openPath)

  if (b?.maximized && !offset) win.maximize()

  win.on('ready-to-show', () => {
    win?.show()
    // The test harnesses drive the first window only.
    if (process.env['MARKNOTE_SHOTS'] === '1' && isFirstWindow) {
      import('./shots')
        .then((m) => m.runShots(win, join(app.getAppPath(), 'store-screenshots')))
        .catch((err) => {
          console.error('[shots] failed to start:', err)
          app.exit(1)
        })
      return
    }
    if (process.env['MARKNOTE_SMOKE'] === '1' && isFirstWindow) {
      import('./smoke')
        .then((m) => m.runSmoke(win, join(app.getAppPath(), 'out', 'smoke')))
        .catch((err) => {
          // Without this the harness fails silently and looks like a hang.
          console.error('[smoke] harness failed to start:', err)
          app.exit(1)
        })
      return
    }
    // Note: a file passed on the command line is NOT opened here. 'ready-to-show'
    // fires when the page has painted, which can be before React has mounted and
    // subscribed to IPC — the message would be sent into the void. The renderer
    // announces itself via 'renderer:ready' instead, and we flush it then.
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    // One narrow exception to the http-only rule: the Store's own review
    // dialog for this exact product. Pinning the whole URL rather than the
    // scheme means a stray link cannot use ms-windows-store: to open an
    // arbitrary Store page or protocol handler.
    else if (url === STORE_REVIEW_URL) shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * The window only ever shows the app itself. Any other navigation (a link
   * clicked in a document, a file dropped on the window) is stopped; web
   * links open in the browser instead. This used to let through every
   * `file://` URL and every `http://localhost` address, so a link could
   * replace the app with a local page that then had the app's preload.
   */
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const home = isDev && devUrl ? new URL(devUrl) : new URL(`${APP_SCHEME}://${APP_HOST}/`)
  const isHome = (url: string): boolean => {
    try {
      const u = new URL(url)
      return u.protocol === home.protocol && u.host === home.host
    } catch {
      return false
    }
  }
  win.webContents.on('will-navigate', (e, url) => {
    if (isHome(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })
  win.webContents.on('will-redirect', (e, url) => {
    if (!isHome(url)) e.preventDefault()
  })

  win.on('close', (e) => {
    if (!win) return
    const bounds = win.getNormalBounds()
    setSettings({
      windowBounds: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized()
      }
    })
    // Ask the renderer whether it is safe to quit (unsaved changes prompt).
    if (!(win as BrowserWindow & { __forceClose?: boolean }).__forceClose) {
      e.preventDefault()
      win.webContents.send('app:before-close')
    }
  })

  win.on('closed', () => {
    windows.delete(win)
    if (lastFocused === win) lastFocused = null
    stopWatchingId(winId)
    windowFiles.delete(winId)
    pendingOpen.delete(winId)
  })

  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`)
  }

  buildMenu(win, (action, payload) => currentWindow()?.webContents.send('menu:action', { action, payload }))

  /*
   * The native menu stays registered but its bar is hidden.
   *
   * Registering it is what binds the accelerators and the operating-system
   * roles - cut, paste, full screen, developer tools, quit. Removing the menu
   * to draw our own would have silently unbound roughly thirty shortcuts. The
   * window draws its own menu instead, which is the part that could not be
   * styled and was too small to read.
   */
  win.setMenuBarVisibility(false)
  return win
}

function send(channel: string, payload?: unknown): void {
  currentWindow()?.webContents.send(channel, payload)
}

/**
 * Loads a file into a window that has nothing to lose: a new window, or the
 * first one at start-up. Any other window goes through the renderer's own
 * open path (menu action file:openPath), which asks about unsaved changes.
 */
async function openPathInRenderer(filePath: string, win = currentWindow()): Promise<void> {
  if (!win) return
  try {
    const content = await fsp.readFile(filePath, 'utf8')
    addRecent(filePath)
    buildMenu(win, (a, p) => currentWindow()?.webContents.send('menu:action', { action: a, payload: p }))
    watchFile(filePath, win)
    win.webContents.send('file:opened', { filePath, content })
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
    const owner = currentWindow()
    if (owner) buildMenu(owner, (a, p) => send('menu:action', { action: a, payload: p }))
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

function stopWatchingId(id: number): void {
  try {
    watchers.get(id)?.close()
  } catch {
    /* ignore */
  }
  watchers.delete(id)
}

function stopWatching(win = currentWindow()): void {
  if (win) stopWatchingId(win.id)
}

/** Watches the file a window shows, and tells that window when it changes. */
function watchFile(filePath: string, win = currentWindow()): void {
  if (!win) return
  const id = win.id
  stopWatchingId(id)
  windowFiles.set(id, filePath)
  try {
    let timer: NodeJS.Timeout | null = null
    watchers.set(
      id,
      fsWatch(filePath, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (!win.isDestroyed()) win.webContents.send('file:changed-on-disk', { filePath })
        }, 250)
      })
    )
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

/*
 * The folder a file dialog opens in.
 *
 * Until Electron 43, a dialog given no starting folder let Windows choose,
 * which meant the folder last used. Since 43 it opens in Downloads every time
 * instead, so Open, Convert, Insert image and the exports would all have
 * started in Downloads, whatever the user had just been working in. The app
 * now remembers the folder itself, across restarts, and falls back to
 * Documents.
 */
function lastFolder(): string {
  const dir = getSettings().lastDialogDir
  return dir && existsSync(dir) ? dir : app.getPath('documents')
}

function rememberFolder(filePath: string | undefined): void {
  if (filePath) setSettings({ lastDialogDir: dirname(filePath) })
}

/** A suggested file name, placed in the last folder unless it has one. */
function inLastFolder(name: string): string {
  return isAbsolute(name) ? name : join(lastFolder(), basename(name))
}

function registerIpc(): void {
  /*
   * Every IPC handler runs with the window that sent it as currentWindow(),
   * so dialogs open over that window and files are watched for it, even when
   * another window has the focus (an autosave in a window behind, say).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args) => senderWindow.run(BrowserWindow.fromWebContents(e.sender), () => fn(e, ...args)))
  }

  handle('dialog:open', async (_e, opts?: { folder?: string }) => {
    const r = await dialog.showOpenDialog(currentWindow()!, {
      title: 'Open document',
      // File > "Open from OneDrive…" and the like start in that folder.
      defaultPath: opts?.folder && existsSync(opts.folder) ? opts.folder : lastFolder(),
      properties: ['openFile'],
      filters: [
        { name: 'Markdown & text', extensions: READABLE_EXTS },
        { name: 'Convertible documents', extensions: CONVERTIBLE_EXTS },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    rememberFolder(r.filePaths[0])
    return readOrOfferConversion(r.filePaths[0])
  })

  handle('file:read', async (_e: IpcMainInvokeEvent, filePath: string) =>
    readOrOfferConversion(filePath)
  )

  handle('file:save', async (_e, args: { filePath: string | null; content: string; saveAs?: boolean; quiet?: boolean; folder?: string }) => {
    let target = args.filePath
    // AutoSave never opens a dialog: a document with no file gets a recovery
    // copy instead (recovery:write).
    if (args.quiet && (!target || args.saveAs)) return { ok: false, canceled: true }
    if (!target || args.saveAs) {
      const r = await dialog.showSaveDialog(currentWindow()!, {
        title: args.saveAs ? 'Save a copy as' : 'Save Markdown file',
        // "Save to OneDrive…" and the like: that folder, keeping the name.
        defaultPath:
          args.folder && existsSync(args.folder)
            ? join(args.folder, target ? basename(target) : 'Untitled.md')
            : (target ?? join(lastFolder(), 'Untitled.md')),
        filters: MD_FILTERS
      })
      if (r.canceled || !r.filePath) return { ok: false, canceled: true }
      target = r.filePath
      rememberFolder(target)
      if (!/\.[a-z0-9]+$/i.test(target)) target += '.md'
    }
    try {
      stopWatching()
      await fsp.writeFile(target, args.content, 'utf8')
      // AutoSave (quiet) does not touch the recent list or the menu every
      // 30 seconds; the file is already on both.
      if (!args.quiet) {
        addRecent(target)
        const owner = currentWindow()
        if (owner) buildMenu(owner, (a, p) => send('menu:action', { action: a, payload: p }))
      }
      watchFile(target)
      return { ok: true, filePath: target }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  handle('file:exportHtml', async (_e, args: { html: string; suggestedName: string }) => {
    const r = await dialog.showSaveDialog(currentWindow()!, {
      title: 'Export as HTML',
      defaultPath: inLastFolder(args.suggestedName.replace(/\.[^.]+$/, '') + '.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    rememberFolder(r.filePath)
    try {
      await fsp.writeFile(r.filePath, args.html, 'utf8')
      return { ok: true, filePath: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  handle('file:exportMarkdown', async (_e, args: { text: string; suggestedName: string }) => {
    const r = await dialog.showSaveDialog(currentWindow()!, {
      title: 'Export Markdown without annotations',
      defaultPath: inLastFolder(args.suggestedName.replace(/\.[^.]+$/, '') + '-clean.md'),
      filters: MD_FILTERS
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    rememberFolder(r.filePath)
    try {
      await fsp.writeFile(r.filePath, args.text, 'utf8')
      return { ok: true, filePath: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  handle('file:exportPdf', async (_e, args: { html: string; suggestedName: string }) => {
    const r = await dialog.showSaveDialog(currentWindow()!, {
      title: 'Export as PDF',
      defaultPath: inLastFolder(args.suggestedName.replace(/\.[^.]+$/, '') + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    rememberFolder(r.filePath)
    let w: BrowserWindow | null = null
    try {
      w = await renderInHiddenWindow(args.html)
      const data = await w.webContents.printToPDF({
        printBackground: true,
        // Margins left to Electron's default (1 cm). The old `marginType`
        // option is gone in Electron 44; the printed page's own @page rule
        // sets the margins it wants.
        // A4 unless the document recorded its original page size, which the
        // page's own @page rule then carries (lib/pages.ts).
        pageSize: 'A4',
        preferCSSPageSize: true
      })
      await fsp.writeFile(r.filePath, data)
      return { ok: true, filePath: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    } finally {
      if (w) await disposeHidden(w)
    }
  })

  /*
   * Print, via a preview window.
   *
   * This used to render the document into a hidden window and call
   * `webContents.print()`, which opens the operating system's print dialog
   * directly. On Windows that dialog reports "This app doesn't support print
   * preview", because the preview pane is a service the host application has to
   * provide and Electron does not implement it. There is no flag that turns it
   * on — pressing Print worked, but you could not see what you were about to
   * get, which is the part people actually use.
   *
   * So the preview is produced here instead: lay the document out, run it
   * through `printToPDF` at the same page size and margins the printer will
   * use, and show the result in Chromium's own PDF viewer. That viewer
   * paginates, scrolls, zooms and has its own print button, so what is on
   * screen is the printed pages rather than an approximation of them — and
   * printing from it goes through the same dialog as before.
   *
   * Resolving as soon as the window is showing, rather than waiting for a
   * print to happen, keeps the renderer out of it: from here on the user is
   * dealing with the preview window and may well decide not to print at all.
   */
  handle('file:print', async (_e, args: { html: string; title?: string }) => {
    let layout: BrowserWindow | null = null
    let pdfPath: string | null = null
    try {
      layout = await renderInHiddenWindow(args.html)
      const data = await layout.webContents.printToPDF({
        printBackground: true,
        // Margins left to Electron's default (1 cm). The old `marginType`
        // option is gone in Electron 44; the printed page's own @page rule
        // sets the margins it wants.
        // A4 unless the document recorded its original page size, which the
        // page's own @page rule then carries (lib/pages.ts).
        pageSize: 'A4',
        preferCSSPageSize: true
      })

      pdfPath = join(tmpdir(), `marknote-preview-${Date.now()}.pdf`)
      await fsp.writeFile(pdfPath, data)

      const preview = new BrowserWindow({
        width: 900,
        height: 1000,
        parent: currentWindow() ?? undefined,
        title: `Print preview — ${args.title ?? 'Document'}`,
        autoHideMenuBar: true,
        webPreferences: { plugins: true }
      })
      preview.setMenuBarVisibility(false)

      // The temporary PDF is the window's to own: delete it once the window
      // has gone, not when this handler returns, or the viewer loses the file
      // underneath itself.
      const scratch = pdfPath
      preview.on('closed', () => {
        void fsp.unlink(scratch).catch(() => undefined)
      })
      pdfPath = null

      await preview.loadURL(pathToFileURL(scratch).toString())
      preview.show()
      return { ok: true }
    } catch (err) {
      if (pdfPath) await fsp.unlink(pdfPath).catch(() => undefined)
      return { ok: false, error: String((err as Error).message ?? err) }
    } finally {
      if (layout) await disposeHidden(layout)
    }
  })

  handle('find:start', (_e, args: { text: string; forward?: boolean; findNext?: boolean }) => {
    if (!args.text) return { ok: false }
    currentWindow()?.webContents.findInPage(args.text, {
      forward: args.forward ?? true,
      findNext: args.findNext ?? false,
      matchCase: false
    })
    return { ok: true }
  })

  handle('find:stop', () => {
    currentWindow()?.webContents.stopFindInPage('clearSelection')
    return { ok: true }
  })

  handle('settings:get', () => {
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

  handle('settings:set', (_e, patch: Record<string, unknown>) => {
    // Guard against the renderer overwriting stored keys with the placeholder.
    if (patch.aiKeys) delete patch.aiKeys
    return setSettings(patch)
  })

  /* ------------------------------------------------------------------ AI */

  handle('ai:status', (_e, provider: ai.ProviderId) => ai.status(provider))
  handle('ai:models', (_e, provider: ai.ProviderId) => ai.listModels(provider))
  handle('ai:chat', (_e, req: ai.ChatRequest) => ai.chat(req))

  handle('ai:keyState', () => {
    const keys = getSettings().aiKeys
    return {
      encryption: secrets.isEncryptionAvailable(),
      anthropic: { saved: secrets.has(keys.anthropic), hint: secrets.hint(keys.anthropic) },
      openai: { saved: secrets.has(keys.openai), hint: secrets.hint(keys.openai) },
      gemini: { saved: secrets.has(keys.gemini), hint: secrets.hint(keys.gemini) },
      assemblyai: { saved: secrets.has(keys.assemblyai), hint: secrets.hint(keys.assemblyai) }
    }
  })

  handle('ai:setKey', (_e, args: { provider: 'anthropic' | 'openai' | 'gemini' | 'assemblyai'; key: string }) => {
    const keys = { ...getSettings().aiKeys }
    keys[args.provider] = args.key ? secrets.seal(args.key.trim()) : ''
    setSettings({ aiKeys: keys })
    return { ok: true, encrypted: secrets.isEncryptionAvailable() }
  })

  /* ----------------------------------------------------------- converter */

  handle('convert:pickInput', async () => {
    const r = await dialog.showOpenDialog(currentWindow()!, {
      title: 'Choose documents to convert to Markdown',
      defaultPath: lastFolder(),
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
    rememberFolder(r.filePaths[0])
    return { ok: true, filePaths: r.filePaths }
  })

  /** Raw bytes for the renderer-side converters. Arrives as a Uint8Array. */
  handle('file:readBytes', async (_e, filePath: string) => {
    try {
      const data = await fsp.readFile(filePath)
      return { ok: true, bytes: new Uint8Array(data), name: basename(filePath) }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  handle('file:writeText', async (_e, args: { filePath: string; text: string }) => {
    try {
      await fsp.mkdir(dirname(args.filePath), { recursive: true })
      await fsp.writeFile(args.filePath, args.text, 'utf8')
      return { ok: true, filePath: args.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })

  handle('file:exists', (_e, filePath: string) => existsSync(filePath))

  /**
   * Cloud OCR. Runs here so the Gemini key never reaches renderer code — the
   * same key the AI panel uses, stored encrypted.
   */
  handle('ocr:cloud', async (_e, args: { bytes: Uint8Array; mimeType: string }) => {
    const key = secrets.open(getSettings().aiKeys.gemini)
    if (!key) return { ok: false, code: 'NO_KEY', error: 'No Google Gemini API key has been saved.' }
    return ai.visionOcr(key, Buffer.from(args.bytes).toString('base64'), args.mimeType)
  })

  /**
   * Audio transcription. Cloud-only by necessity; progress is streamed back so
   * the user can see it is alive during a long job, and it can be cancelled.
   */
  handle('transcribe:audio', async (_e, args: { bytes: Uint8Array; jobId: string }) => {
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

  handle('transcribe:cancel', (_e, jobId: string) => {
    transcribeJobs.get(jobId)?.abort()
    return { ok: true }
  })

  handle('convert:pickOutput', async (_e, args: { suggestedName: string }) => {
    const dir = getSettings().convertDir
    const r = await dialog.showSaveDialog(currentWindow()!, {
      title: 'Save converted Markdown as',
      defaultPath: join(dir && existsSync(dir) ? dir : app.getPath('documents'), args.suggestedName),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    let target = r.filePath
    if (!/\.md$/i.test(target)) target += '.md'
    return { ok: true, filePath: target, dir: dirname(target) }
  })

  handle('convert:pickFolder', async () => {
    const r = await dialog.showOpenDialog(currentWindow()!, {
      title: 'Choose the default folder for converted files',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getSettings().convertDir ?? app.getPath('documents')
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, dir: r.filePaths[0] }
  })

  handle('convert:suggestDir', (_e, args: { input?: string }) => {
    const settings = getSettings()
    if (settings.convertDir && existsSync(settings.convertDir)) return settings.convertDir
    if (args?.input) return dirname(args.input)
    return app.getPath('documents')
  })

  handle('dialog:confirmUnsaved', async (_e, args: { name: string }) => {
    // The test harness runs in a throwaway profile and cannot click a dialog;
    // a real one would stall the run. Its edits are never worth keeping.
    if (harness) return 'discard'
    const r = await dialog.showMessageBox(currentWindow()!, {
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

  handle('dialog:confirm', async (_e, args: { title: string; message: string; detail?: string }) => {
    const r = await dialog.showMessageBox(currentWindow()!, {
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

  handle('dialog:message', async (_e, args: { type?: string; title: string; message: string; detail?: string }) => {
    await dialog.showMessageBox(currentWindow()!, {
      type: (args.type as 'info') ?? 'info',
      title: args.title,
      message: args.message,
      detail: args.detail,
      buttons: ['OK']
    })
    return true
  })

  handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(currentWindow()!, {
      title: 'Insert image',
      defaultPath: lastFolder(),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    rememberFolder(r.filePaths[0])
    return { ok: true, filePath: r.filePaths[0] }
  })

  /**
   * The renderer calls this once its listeners are attached. Any file passed on
   * the command line — which is how Windows opens a .md by double-click — is
   * delivered now, when something is actually listening for it.
   */
  handle('app:rendererReady', () => {
    const win = currentWindow()
    const path = win ? pendingOpen.get(win.id) : undefined
    if (win && path) {
      pendingOpen.delete(win.id)
      void openPathInRenderer(path, win)
    }
    const recovered = win ? pendingRecovery.get(win.id) : undefined
    if (win && recovered) {
      pendingRecovery.delete(win.id)
      recoveryOwners.set(recovered.id, win.id)
      win.webContents.send('file:recovered', recovered)
    } else if (win && !path && !recoveryOffered && !harness) {
      recoveryOffered = true
      void offerRecovery(win)
    }
    return { ok: true }
  })

  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  handle('app:setTitle', (_e, args: { filePath: string | null; dirty: boolean }) => {
    const name = args.filePath ? basename(args.filePath) : 'Untitled'
    const win = currentWindow()
    win?.setTitle(`${args.dirty ? '• ' : ''}${name} — ${APP_DISPLAY_NAME}`)
    if (args.filePath) win?.setRepresentedFilename?.(args.filePath)
    // Which file each window shows, so a file opened from Explorer that is
    // already open just brings its window forward.
    if (win) {
      if (args.filePath) windowFiles.set(win.id, args.filePath)
      else windowFiles.delete(win.id)
    }
    return true
  })

  handle('app:forceClose', () => {
    const w = currentWindow()
    if (w) {
      ;(w as BrowserWindow & { __forceClose?: boolean }).__forceClose = true
      w.close()
    }
    return true
  })

  handle('path:dirname', (_e, p: string) => dirname(p))
  handle('path:basename', (_e, p: string) => basename(p))

  handle('app:command', (_e, name: string) => {
    const w = currentWindow()
    if (!w) return

    /*
     * Clipboard commands go through webContents, not document.execCommand.
     * Chromium refuses execCommand('paste') for security, so the menu item
     * did nothing while Ctrl+V worked - the accelerator was reaching the
     * native handler that the menu item was not. These are the same
     * operations the native menu roles performed.
     */
    if (name === 'cut') w.webContents.cut()
    else if (name === 'copy') w.webContents.copy()
    else if (name === 'paste') w.webContents.paste()
    else if (name === 'selectAll') w.webContents.selectAll()
    else if (name === 'fullscreen') w.setFullScreen(!w.isFullScreen())
    else if (name === 'devtools') w.webContents.toggleDevTools()
    else if (name === 'quit') w.close()
    else if (name === 'clearRecent') {
      // The hidden native menu still lists them, so it is rebuilt too.
      clearRecent()
      buildMenu(w, (a, p2) => currentWindow()?.webContents.send('menu:action', { action: a, payload: p2 }))
    }
  })

  /*
   * Recovery copies (AutoSave, for documents it cannot save into a file: new,
   * converted or merged ones not yet named, or any document while AutoSave is
   * off). One JSON file per open document, under the profile's Recovery
   * folder, rewritten every 30 s while it has unsaved changes and deleted
   * once it is saved or deliberately discarded. What is left after a crash
   * or a forced close is offered back at the next start (offerRecovery).
   */
  handle('recovery:write', async (_e, args: { id: string; name: string; filePath: string | null; content: string }) => {
    if (!/^[\w-]{8,64}$/.test(args.id)) return { ok: false }
    const win = currentWindow()
    if (win) recoveryOwners.set(args.id, win.id)
    await fsp.mkdir(recoveryDir(), { recursive: true })
    const entry: RecoveryEntry = { ...args, savedAt: new Date().toISOString() }
    await fsp.writeFile(join(recoveryDir(), `${args.id}.json`), JSON.stringify(entry), 'utf8')
    return { ok: true }
  })

  handle('recovery:clear', async (_e, id: string) => {
    if (!/^[\w-]{8,64}$/.test(id)) return { ok: false }
    recoveryOwners.delete(id)
    await fsp.unlink(join(recoveryDir(), `${id}.json`)).catch(() => undefined)
    return { ok: true }
  })

  // Cloud storage: the folders OneDrive, Google Drive and the rest sync.
  handle('cloud:folders', () => cloudFolders())

  handle('cloud:addFolder', async () => {
    const r = await dialog.showOpenDialog(currentWindow()!, {
      title: 'Add a cloud folder (a folder your cloud storage app keeps in sync)',
      properties: ['openDirectory'],
      defaultPath: app.getPath('home')
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    const path = r.filePaths[0]
    const current = getSettings().cloudFolders ?? []
    if (!current.some((c) => c.path.toLowerCase() === path.toLowerCase())) {
      setSettings({ cloudFolders: [...current, { label: basename(path), path }] })
    }
    return { ok: true, folders: await cloudFolders() }
  })

  // File > New window (Ctrl+Shift+N): another document, side by side.
  handle('app:newWindow', () => {
    createWindow()
    return true
  })
}

/* ------------------------------------------------------------- app lifecycle */

/* --------------------------------------------------------------- recovery */

interface RecoveryEntry {
  id: string
  name: string
  filePath: string | null
  content: string
  savedAt: string
}

const recoveryDir = (): string => join(app.getPath('userData'), 'Recovery')
/** Recovery id -> the window keeping it current. */
const recoveryOwners = new Map<string, number>()
/** Recovered documents waiting for their new window to be ready. */
const pendingRecovery = new Map<number, RecoveryEntry>()
let recoveryOffered = false

/**
 * At start-up: documents left with unsaved changes when the app last closed
 * without saving them (a crash, a power cut, Windows restarting for updates)
 * are offered back, each in its own window.
 */
async function offerRecovery(win: BrowserWindow): Promise<void> {
  let entries: RecoveryEntry[] = []
  try {
    const files = (await fsp.readdir(recoveryDir())).filter((f) => f.endsWith('.json'))
    for (const f of files) {
      try {
        const entry = JSON.parse(await fsp.readFile(join(recoveryDir(), f), 'utf8')) as RecoveryEntry
        if (!recoveryOwners.has(entry.id) && typeof entry.content === 'string') entries.push(entry)
      } catch {
        /* a damaged copy is skipped, not fatal */
      }
    }
  } catch {
    return // no Recovery folder: nothing to offer
  }
  if (!entries.length) return
  entries = entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  const names = entries.map((e) => `• ${e.name} (${new Date(e.savedAt).toLocaleString()})`).join('\n')
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Recover unsaved documents',
    message:
      entries.length === 1
        ? 'A document had unsaved changes when the app last closed.'
        : `${entries.length} documents had unsaved changes when the app last closed.`,
    detail: `${names}\n\nRecover them? Each opens in its own window, with the changes still unsaved.`,
    buttons: ['Recover', 'Discard', 'Not now'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (r.response === 2) return
  if (r.response === 1) {
    for (const e of entries) await fsp.unlink(join(recoveryDir(), `${e.id}.json`)).catch(() => undefined)
    return
  }
  const [first, ...rest] = entries
  recoveryOwners.set(first.id, win.id)
  win.webContents.send('file:recovered', first)
  for (const e of rest) {
    const w = createWindow()
    pendingRecovery.set(w.id, e)
  }
}

const samePath = (a: string, b: string): boolean => normalize(a).toLowerCase() === normalize(b).toLowerCase()

/** Where a file from Explorer should open: a new window, or the one in front. */
async function chooseWhereToOpen(win: BrowserWindow, filePath: string): Promise<'new' | 'here' | 'cancel'> {
  const remembered = getSettings().openFromExplorer
  if (remembered === 'new' || remembered === 'here') return remembered
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Open document',
    message: `Open “${basename(filePath)}”`,
    detail:
      'In a new window, so you can keep both documents open side by side, or in this window instead of the ' +
      'current document (you will be asked about any unsaved changes first).',
    buttons: ['New window', 'This window', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: 'Remember my choice (change it later under File)'
  })
  const choice = (['new', 'here', 'cancel'] as const)[r.response]
  if (r.checkboxChecked && choice !== 'cancel') setSettings({ openFromExplorer: choice })
  return choice
}

async function openFromOutside(filePath: string | null): Promise<void> {
  if (!filePath) {
    createWindow()
    return
  }
  for (const w of windows) {
    const shown = windowFiles.get(w.id)
    if (shown && samePath(shown, filePath)) {
      if (w.isMinimized()) w.restore()
      w.focus()
      return
    }
  }
  const front = currentWindow()
  if (!front) {
    createWindow(filePath)
    return
  }
  if (front.isMinimized()) front.restore()
  front.focus()
  const choice = await chooseWhereToOpen(front, filePath)
  if (choice === 'new') createWindow(filePath)
  else if (choice === 'here') front.webContents.send('menu:action', { action: 'file:openPath', payload: filePath })
}

function fileFromArgv(argv: string[]): string | null {
  const candidates = argv.slice(1).filter((a) => !a.startsWith('--') && /\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(a))
  return candidates[0] ?? null
}

/*
 * The smoke and screenshot harnesses get a throwaway profile of their own.
 *
 * Before this they ran against the user's real one, which had two effects.
 * They wrote into it — recent files, the chosen AI provider — so the smoke
 * test had to carry steps that put settings back afterwards. And the
 * single-instance lock below is taken on the profile folder, so a test run
 * could not start at all while the app was open for real use.
 *
 * Set before the lock is requested, because the lock is keyed on this path.
 * Cleared each run so every run starts from the same empty state.
 */
const harness = process.env['MARKNOTE_SMOKE'] === '1' || process.env['MARKNOTE_SHOTS'] === '1'
if (harness) {
  const profile = join(tmpdir(), `${APP_ASCII_NAME} (test run)`)
  rmSync(profile, { recursive: true, force: true })
  app.setPath('userData', profile)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  /*
   * Windows starts a second copy of the app for every .md double-clicked in
   * Explorer while it is already running; that copy hands its arguments here
   * and quits. The file opens where the user says (chooseWhereToOpen), never
   * over a document with unsaved changes without asking. A file that is
   * already open just brings its window forward. Started again with no file
   * (from the Start menu, say), a new empty window opens, as Word does.
   */
  app.on('second-instance', (_e, argv) => {
    void openFromOutside(fileFromArgv(argv))
  })

  app.on('open-file', (e, path) => {
    e.preventDefault()
    if (app.isReady()) void openFromOutside(path)
    else pendingOpenPath = path
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    app.setName(APP_DISPLAY_NAME)
    // The display name contains a superscript ²; keep the settings folder ASCII
    // so no tool trips over a Unicode path.
    if (!harness) app.setPath('userData', join(app.getPath('appData'), APP_ASCII_NAME))
    registerLocalImageProtocol()
    registerAppProtocol()
    hardenSessions()
    registerIpc()
    createWindow(fileFromArgv(process.argv) ?? pendingOpenPath ?? undefined)
    pendingOpenPath = null

    nativeTheme.on('updated', () => {
      for (const w of windows) w.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

type Listener<T> = (payload: T) => void

function on<T>(channel: string, cb: Listener<T>): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  openDialog: (opts?: { folder?: string }) => ipcRenderer.invoke('dialog:open', opts),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (args: { filePath: string | null; content: string; saveAs?: boolean; quiet?: boolean; folder?: string; purpose?: 'autosave' }) =>
    ipcRenderer.invoke('file:save', args),
  exportHtml: (args: { html: string; suggestedName: string }) => ipcRenderer.invoke('file:exportHtml', args),
  exportPdf: (args: { html: string; suggestedName: string }) => ipcRenderer.invoke('file:exportPdf', args),
  exportMarkdown: (args: { text: string; suggestedName: string }) => ipcRenderer.invoke('file:exportMarkdown', args),
  /** Annotations files and summaries (annotationTransfer.ts). */
  exportText: (args: { text: string; suggestedName: string; folder?: string; title?: string }) =>
    ipcRenderer.invoke('file:exportText', args),
  pickAnnotations: (opts?: { folder?: string }): Promise<{ ok: boolean; canceled?: boolean; name?: string; content?: string; error?: string }> =>
    ipcRenderer.invoke('dialog:pickAnnotations', opts),
  annotationsBeside: (filePath: string): Promise<{ name: string; content: string } | null> =>
    ipcRenderer.invoke('file:annotationsBeside', filePath),
  print: (args: { html: string; title?: string }) => ipcRenderer.invoke('file:print', args),

  findStart: (args: { text: string; forward?: boolean; findNext?: boolean }) => ipcRenderer.invoke('find:start', args),
  findStop: () => ipcRenderer.invoke('find:stop'),

  /**
   * Full screen, developer tools and quit: the three menu commands that have
   * no application-level meaning and can only be done by the main process.
   */
  appCommand: (
    name:
      | 'cut'
      | 'copy'
      | 'paste'
      | 'selectAll'
      | 'fullscreen'
      | 'devtools'
      | 'quit'
      | 'clearRecent'
  ) =>
    ipcRenderer.invoke('app:command', name),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),

  confirmUnsaved: (name: string) => ipcRenderer.invoke('dialog:confirmUnsaved', { name }),
  confirm: (args: { title: string; message: string; detail?: string }) => ipcRenderer.invoke('dialog:confirm', args),
  message: (args: { type?: string; title: string; message: string; detail?: string }) =>
    ipcRenderer.invoke('dialog:message', args),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  // Converter. Conversion itself runs in the renderer; the main process only
  // supplies bytes, writes results, and performs the key-holding OCR call.
  convertPickInput: () => ipcRenderer.invoke('convert:pickInput'),
  convertPickOutput: (args: { suggestedName: string }) => ipcRenderer.invoke('convert:pickOutput', args),
  convertPickFolder: () => ipcRenderer.invoke('convert:pickFolder'),
  convertSuggestDir: (args: { input?: string }) => ipcRenderer.invoke('convert:suggestDir', args),
  readBytes: (filePath: string) => ipcRenderer.invoke('file:readBytes', filePath),
  writeText: (args: { filePath: string; text: string }) => ipcRenderer.invoke('file:writeText', args),
  fileExists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  cloudOcr: (args: { bytes: Uint8Array; mimeType: string }) => ipcRenderer.invoke('ocr:cloud', args),
  transcribeAudio: (args: { bytes: Uint8Array; jobId: string }) => ipcRenderer.invoke('transcribe:audio', args),
  cancelTranscription: (jobId: string) => ipcRenderer.invoke('transcribe:cancel', jobId),
  onTranscribeProgress: (cb: Listener<{ jobId: string; message: string; fraction?: number }>) =>
    on('transcribe:progress', cb),

  /** Electron 32+ removed File.path; this is the supported replacement. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  // AI (all provider calls happen in the main process; keys never come back here)
  aiStatus: (provider: string) => ipcRenderer.invoke('ai:status', provider),
  aiModels: (provider: string) => ipcRenderer.invoke('ai:models', provider),
  aiChat: (req: unknown) => ipcRenderer.invoke('ai:chat', req),
  aiKeyState: () => ipcRenderer.invoke('ai:keyState'),
  aiSetKey: (args: { provider: string; key: string }) => ipcRenderer.invoke('ai:setKey', args),

  /** True only during the gated end-to-end smoke run; never set for users. */
  smokeMode: process.env['MARKNOTE_SMOKE'] === '1',

  rendererReady: () => ipcRenderer.invoke('app:rendererReady'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setTitle: (args: { filePath: string | null; dirty: boolean }) => ipcRenderer.invoke('app:setTitle', args),
  forceClose: () => ipcRenderer.invoke('app:forceClose'),
  /** File > New window: another document window. */
  newWindow: () => ipcRenderer.invoke('app:newWindow'),
  compareWindows: (): Promise<Array<{ id: number; name: string }>> => ipcRenderer.invoke('compare:windows'),
  compareWindowText: (id: number): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('compare:windowText', id),
  compareSetWindowText: (args: { id: number; content: string }): Promise<boolean> => ipcRenderer.invoke('compare:setWindowText', args),
  /** Synced cloud folders on this PC (main/cloud-folders.ts). */
  cloudFolders: (): Promise<Array<{ provider: string; label: string; path: string }>> => ipcRenderer.invoke('cloud:folders'),
  addCloudFolder: (): Promise<{ ok: boolean; folders?: Array<{ provider: string; label: string; path: string }> }> =>
    ipcRenderer.invoke('cloud:addFolder'),
  /** AutoSave's recovery copies (main/index.ts, recovery:*). */
  writeRecovery: (args: { id: string; name: string; filePath: string | null; content: string }) =>
    ipcRenderer.invoke('recovery:write', args),
  clearRecovery: (id: string) => ipcRenderer.invoke('recovery:clear', id),
  onFileRecovered: (cb: Listener<{ id: string; name: string; filePath: string | null; content: string; savedAt: string }>) =>
    on('file:recovered', cb),
  dirname: (p: string) => ipcRenderer.invoke('path:dirname', p),
  basename: (p: string) => ipcRenderer.invoke('path:basename', p),

  onMenuAction: (cb: Listener<{ action: string; payload?: unknown }>) => on('menu:action', cb),
  onFileOpened: (cb: Listener<{ filePath: string; content: string }>) => on('file:opened', cb),
  onFileChangedOnDisk: (cb: Listener<{ filePath: string }>) => on('file:changed-on-disk', cb),
  onBeforeClose: (cb: Listener<void>) => on('app:before-close', cb),
  onSystemThemeChanged: (cb: Listener<boolean>) => on('theme:system-changed', cb)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

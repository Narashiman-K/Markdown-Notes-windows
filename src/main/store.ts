import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export interface Settings {
  recentFiles: string[]
  theme: 'light' | 'dark' | 'system'
  zoom: number
  author: string
  windowBounds?: { width: number; height: number; x?: number; y?: number; maximized?: boolean }
  /** Remembered destination folder for converted Markdown. */
  convertDir: string | null
  /** Whether to open a converted file straight away. */
  convertOpenAfter: 'ask' | 'always' | 'never'
  /** Whether opening a non-Markdown file offers conversion. */
  convertOnOpen: 'ask' | 'always' | 'never'
  /** AI credentials, encrypted at rest via safeStorage (DPAPI on Windows). */
  aiKeys: { anthropic: string; openai: string; gemini: string; assemblyai: string }
  aiProvider: 'ollama' | 'anthropic' | 'openai' | 'gemini'
  aiModel: string
  /** Show a diff for approval before AI changes touch the document. */
  aiReviewChanges: boolean
}

const DEFAULTS: Settings = {
  recentFiles: [],
  theme: 'system',
  zoom: 1,
  author: '',
  convertDir: null,
  convertOpenAfter: 'ask',
  convertOnOpen: 'ask',
  aiKeys: { anthropic: '', openai: '', gemini: '', assemblyai: '' },
  aiProvider: 'ollama',
  aiModel: '',
  aiReviewChanges: true
}

let cache: Settings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (cache) return cache
  let next: Settings = { ...DEFAULTS }
  try {
    if (existsSync(file())) {
      const saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
      next = {
        ...DEFAULTS,
        ...saved,
        aiKeys: { ...DEFAULTS.aiKeys, ...(saved.aiKeys ?? {}) }
      }
    }
  } catch {
    next = { ...DEFAULTS }
  }
  cache = next
  return next
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  cache = next
  try {
    writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* non-fatal */
  }
  return next
}

export function addRecent(path: string): string[] {
  const s = getSettings()
  const list = [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, 12)
  setSettings({ recentFiles: list })
  return list
}

export function clearRecent(): void {
  setSettings({ recentFiles: [] })
}

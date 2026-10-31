/**
 * The cloud storage folders on this PC.
 *
 * OneDrive, Google Drive, Dropbox, iCloud and Box all keep a folder on the
 * disk that their desktop app syncs. Opening and saving there is how this app
 * works with them: no sign-in inside the app, nothing sent anywhere by it,
 * and every provider with a desktop app works the same way. This finds the
 * usual ones; File > "Add a cloud folder…" adds any other (another provider,
 * a company share), kept in settings.cloudFolders.
 *
 * Read fresh each time it is asked, because folders come and go: OneDrive
 * signed into, Google Drive's drive letter mounted after the app started.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { promisify } from 'node:util'
import { getSettings } from './store'

export interface CloudFolder {
  provider: 'onedrive' | 'googledrive' | 'dropbox' | 'icloud' | 'box' | 'custom'
  label: string
  path: string
}

const run = promisify(execFile)

/** OneDrive accounts from the registry: the environment only names one. */
async function oneDriveFromRegistry(): Promise<Array<{ label: string; path: string }>> {
  try {
    const { stdout } = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s', '/v', 'UserFolder'], {
      windowsHide: true,
      timeout: 4000
    })
    const out: Array<{ label: string; path: string }> = []
    let account = ''
    for (const line of stdout.split(/\r?\n/)) {
      const key = /\\Accounts\\([^\\]+)\s*$/.exec(line)
      if (key) account = key[1]
      const value = /UserFolder\s+REG_SZ\s+(.+)$/.exec(line)
      if (value) out.push({ label: account.startsWith('Business') ? 'OneDrive (work)' : 'OneDrive', path: value[1].trim() })
    }
    return out
  } catch {
    return []
  }
}

function dropboxFolders(): Array<{ label: string; path: string }> {
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!base) continue
    const info = join(base, 'Dropbox', 'info.json')
    if (!existsSync(info)) continue
    try {
      const data = JSON.parse(readFileSync(info, 'utf8')) as Record<string, { path?: string }>
      return Object.entries(data)
        .filter(([, v]) => v?.path)
        .map(([kind, v]) => ({ label: kind === 'business' ? 'Dropbox (work)' : 'Dropbox', path: v.path as string }))
    } catch {
      /* unreadable: skip */
    }
  }
  return []
}

export async function cloudFolders(): Promise<CloudFolder[]> {
  const found: CloudFolder[] = []
  const add = (provider: CloudFolder['provider'], label: string, path: string | undefined): void => {
    if (!path || !existsSync(path)) return
    if (found.some((f) => f.path.toLowerCase() === path.toLowerCase())) return
    found.push({ provider, label, path })
  }

  if (process.platform === 'win32') {
    add('onedrive', 'OneDrive', process.env.OneDriveConsumer)
    add('onedrive', 'OneDrive (work)', process.env.OneDriveCommercial)
    add('onedrive', 'OneDrive', process.env.OneDrive)
    for (const a of await oneDriveFromRegistry()) add('onedrive', a.label, a.path)

    // Google Drive for desktop mounts a drive (G: by default) with "My Drive".
    for (let c = 'D'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
      add('googledrive', 'Google Drive', `${String.fromCharCode(c)}:\\My Drive`)
    }
    const home = process.env.USERPROFILE ?? ''
    add('googledrive', 'Google Drive', join(home, 'Google Drive', 'My Drive'))
    add('googledrive', 'Google Drive', join(home, 'Google Drive'))
    for (const d of dropboxFolders()) add('dropbox', d.label, d.path)
    add('dropbox', 'Dropbox', join(home, 'Dropbox'))
    add('icloud', 'iCloud Drive', join(home, 'iCloudDrive'))
    add('box', 'Box', join(home, 'Box'))
  }

  for (const c of getSettings().cloudFolders ?? []) add('custom', c.label || basename(c.path), c.path)
  return found
}

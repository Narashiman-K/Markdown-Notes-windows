/**
 * Builds the Microsoft Store packages (.appx, x64 and arm64).
 *
 * electron-builder makes .appx files with Microsoft's makeappx.exe. By default
 * it downloads its own copy inside the winCodeSign archive, and on this machine
 * that archive cannot be unpacked: it contains macOS symbolic links, which
 * Windows only creates with Developer Mode or an elevated shell (the same
 * problem scripts/package.mjs works around for the installer). The build then
 * failed with "spawn UNKNOWN".
 *
 * When the Windows SDK is installed, its own makeappx.exe is used instead, for
 * this machine's architecture, through electron-builder's
 * ELECTRON_BUILDER_WINDOWS_KITS_PATH. Without the SDK (GitHub's build machines,
 * say) electron-builder's download is left to do its job as before.
 *
 * Run through `npm run dist:store`, which builds the app first.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

function newestKit() {
  if (process.env.ELECTRON_BUILDER_WINDOWS_KITS_PATH || !existsSync(kits)) return null
  const versions = readdirSync(kits)
    .filter((v) => /^10\.\d+\.\d+\.\d+$/.test(v) && existsSync(join(kits, v, arch, 'makeappx.exe')))
    .sort((a, b) => {
      const x = a.split('.').map(Number)
      const y = b.split('.').map(Number)
      for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i]
      return 0
    })
  return versions.length ? join(kits, versions[0], arch) : null
}

const env = { ...process.env }
const kit = newestKit()
if (kit) {
  env.ELECTRON_BUILDER_WINDOWS_KITS_PATH = kit
  console.log(`Using the installed Windows SDK: ${kit}`)
} else if (!env.ELECTRON_BUILDER_WINDOWS_KITS_PATH) {
  console.log("No Windows SDK found; electron-builder will use its own tools.")
}

const r = spawnSync('npx', ['electron-builder', '--win', 'appx', '--x64', '--arm64', '--publish', 'never'], {
  stdio: 'inherit',
  env,
  shell: true
})
process.exit(r.status ?? 1)

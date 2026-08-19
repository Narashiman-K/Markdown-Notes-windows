/**
 * Two-phase Windows packaging.
 *
 * electron-builder normally stamps the icon and version metadata onto the
 * executable itself (via rcedit) as part of packaging. On this machine that
 * step is blocked: electron-builder first unpacks its winCodeSign toolchain,
 * that archive contains macOS symlinks, and creating symlinks on Windows needs
 * Developer Mode or an elevated shell. The extraction fails and takes the whole
 * build with it.
 *
 * So we split the job:
 *   1. Package with executable editing disabled  -> unpacked app directory
 *   2. Run rcedit ourselves on that directory    -> icon + version metadata
 *   3. Build the installer from the prepackaged directory
 *
 * The result is identical to a normal build, without needing Developer Mode.
 * Once Developer Mode is on, plain `npm run dist` does all of this natively.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(pathToFileURL(join(root, 'package.json')))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const DISPLAY_NAME = 'Suprasūtā Markdown Notes'
const AUTHOR = 'Narashiman Krishnamurthy'
const arch = process.argv.includes('--x64') ? 'x64' : process.arch === 'arm64' ? 'arm64' : 'x64'
const unpacked = join(root, 'release', `win-${arch === 'x64' ? '' : arch + '-'}unpacked`)

function run(cmd, args, label) {
  process.stdout.write(`\n▸ ${label}\n`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false })
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status})`)
    process.exit(r.status ?? 1)
  }
}

const builder = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

// 1 — package without touching the executable
run(
  process.execPath,
  [builder, '--win', '--dir', `--${arch}`, '--config.win.signAndEditExecutable=false'],
  'Packaging application'
)

const exePath = join(unpacked, `${pkg.productName}.exe`)
if (!existsSync(exePath)) {
  console.error(`\n✗ Expected executable not found: ${exePath}`)
  process.exit(1)
}

// 2 — stamp icon and metadata ourselves
// rcedit has shipped as both a bare function and a module with a default
// export depending on the major version; accept either.
const rceditModule = require('rcedit')
const rcedit = typeof rceditModule === 'function' ? rceditModule : rceditModule.default ?? rceditModule.rcedit
if (typeof rcedit !== 'function') {
  console.error('\n✗ Could not resolve the rcedit function from the rcedit package.')
  process.exit(1)
}
process.stdout.write('\n▸ Applying icon and version metadata\n')
await rcedit(exePath, {
  'icon': join(root, 'build', 'icon.ico'),
  'version-string': {
    CompanyName: AUTHOR,
    FileDescription: DISPLAY_NAME,
    ProductName: DISPLAY_NAME,
    OriginalFilename: `${pkg.productName}.exe`,
    LegalCopyright: `Copyright (c) 2026 ${AUTHOR}. Free for personal use.`,
    Comments: `${DISPLAY_NAME} — ${AUTHOR}`
  },
  'file-version': `${pkg.version}.0`,
  'product-version': `${pkg.version}.0`
})

// 3 — build the installer from the directory we just fixed up
run(
  process.execPath,
  [builder, '--win', 'nsis', `--${arch}`, '--prepackaged', unpacked, '--config.win.signAndEditExecutable=false'],
  'Building installer'
)

process.stdout.write('\n✓ Done. Artifacts are in release\\\n')

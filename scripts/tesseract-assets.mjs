/**
 * Stages the Tesseract engine and English language model into
 * `src/renderer/public/tesseract` so offline OCR is genuinely offline.
 *
 * The Windows app had no copy of this until October 2026, and needed it more
 * than the web build: its Content-Security-Policy refuses the CDN that
 * tesseract.js falls back to, so with no local engine offline OCR could never
 * work at all. electron-vite serves `src/renderer/public` at the renderer's
 * root in development and copies it into `out/renderer` for the installed app.
 *
 * Without this, tesseract.js fetches its worker, its WASM core and a ~3 MB
 * language model from jsdelivr the first time a user picks "offline" OCR. The
 * image itself is never uploaded, but the feature simply fails with no signal —
 * which is the one situation offline OCR exists for.
 *
 * The staged files are gitignored: they are copied out of node_modules on every
 * build rather than committed, so they cannot drift from the installed version.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src', 'renderer', 'public', 'tesseract')

/** Resolves a package's directory without importing it. */
function packageDir(name) {
  return dirname(require.resolve(`${name}/package.json`))
}

/**
 * The two SIMD LSTM cores, at roughly 3.9 MB each.
 *
 * tesseract.js probes the processor and asks for the best core it can run:
 * relaxed-SIMD first, then plain SIMD, then the plain build. Only the plain
 * SIMD core used to be staged, on the assumption that it was what browsers
 * would request. It is not: Chromium has had relaxed SIMD since 2023, so the
 * Windows app, Chrome and Edge all asked for the relaxed core, found it
 * missing, and failed. In the Windows app that broke offline OCR outright
 * (its CSP refuses the CDN fallback); in the web app it silently fetched the
 * core from jsdelivr every time, the very request this script exists to
 * prevent. Firefox and Safari take the plain SIMD core.
 *
 * The non-SIMD core is left out: every supported browser has SIMD, and on a
 * device without it ocr.ts falls back to the CDN rather than failing.
 */
const CORES = ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']

async function main() {
  await mkdir(outDir, { recursive: true })

  const copied = []

  const workerSrc = join(packageDir('tesseract.js'), 'dist', 'worker.min.js')
  await copyFile(workerSrc, join(outDir, 'worker.min.js'))
  copied.push('worker.min.js')

  /*
   * The core is taken from the copy tesseract.js itself depends on, not from
   * whatever `tesseract.js-core` happens to sit at the top of node_modules.
   * The two had drifted: tesseract.js 7 (whose worker asks for the
   * relaxed-SIMD core) beside a directly declared tesseract.js-core 6, which
   * has no relaxed-SIMD build. Staging from the wrong one is what left the
   * worker asking for a file that was never copied.
   */
  const coreDir = dirname(
    createRequire(join(packageDir('tesseract.js'), 'package.json')).resolve('tesseract.js-core/package.json')
  )
  const coreVersion = require(join(coreDir, 'package.json')).version
  for (const file of CORES) {
    const src = join(coreDir, file)
    if (!existsSync(src)) {
      throw new Error(
        `Expected ${file} in tesseract.js-core. The package layout changed; ` +
          `update CORES in scripts/tesseract-assets.mjs. Present: ` +
          (await readdir(coreDir)).filter((f) => f.endsWith('.js')).join(', ')
      )
    }
    await copyFile(src, join(outDir, file))
    copied.push(file)
  }

  /**
   * `4.0.0_best_int` is the integerised "best" model: markedly more accurate
   * than the fast model on the scanned and photographed pages this app sees,
   * and 3 MB rather than 11 MB for the full-precision one.
   */
  const langSrc = join(packageDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz')
  await copyFile(langSrc, join(outDir, 'eng.traineddata.gz'))
  copied.push('eng.traineddata.gz')

  let total = 0
  for (const name of copied) total += (await stat(join(outDir, name))).size
  console.log(
    `tesseract: staged ${copied.length} files (core ${coreVersion}), ${(total / 1024 / 1024).toFixed(1)} MB → src/renderer/public/tesseract`
  )
}

main().catch((err) => {
  console.error(`\ntesseract asset staging failed: ${err.message}\n`)
  process.exit(1)
})

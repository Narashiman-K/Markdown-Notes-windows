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

/**
 * The language models built into the app: English, plus Kannada and Hindi
 * (about 1.9 and 1.4 MB). Chosen by the owner for a Store audience that
 * includes India; every other language is to come as a one-off download
 * instead, which keeps the installer small. Must match BUILT_IN_OCR_LANGUAGES
 * in src/lib/ocrLanguages.ts, which tests/ocrLanguages.test.ts checks.
 */
export const LANGUAGES = ['eng', 'kan', 'hin']

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
  for (const lang of LANGUAGES) {
    const file = `${lang}.traineddata.gz`
    await copyFile(join(packageDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', file), join(outDir, file))
    copied.push(file)
  }

  let total = 0
  for (const name of copied) total += (await stat(join(outDir, name))).size
  console.log(
    `tesseract: staged ${copied.length} files (core ${coreVersion}), ${(total / 1024 / 1024).toFixed(1)} MB → src/renderer/public/tesseract`
  )
}

/**
 * The ONNX runtime that runs Whisper (dictation) and the natural voices
 * (read aloud), staged beside Tesseract for the same reason: without a local
 * copy transformers.js fetches it from a CDN, which the Windows app's CSP
 * refuses and which would break "offline". Only the build the WebGPU bundle
 * asks for (asyncify: WebGPU, with the CPU as fallback) is copied: ~26 MB.
 * Taken from the onnxruntime-web that transformers.js itself depends on, so
 * the runtime and its loader can never be from different versions.
 */
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']

async function stageOrt() {
  const ortDir = join(outDir, '..', 'ort')
  await mkdir(ortDir, { recursive: true })
  // Neither package exports its package.json, so look on disk: a copy nested
  // under transformers.js wins over a hoisted one.
  const nested = join(root, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web')
  const ortPkg = existsSync(nested) ? nested : join(root, 'node_modules', 'onnxruntime-web')
  let total = 0
  for (const file of ORT_FILES) {
    const src = join(ortPkg, 'dist', file)
    if (!existsSync(src)) throw new Error(`Expected ${file} in onnxruntime-web/dist; update ORT_FILES.`)
    await copyFile(src, join(ortDir, file))
    total += (await stat(src)).size
  }
  const version = require(join(ortPkg, 'package.json')).version
  console.log(`onnxruntime: staged ${ORT_FILES.length} files (${version}), ${(total / 1024 / 1024).toFixed(1)} MB → ${ortDir}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(stageOrt).catch((err) => {
  console.error(`\ntesseract asset staging failed: ${err.message}\n`)
  process.exit(1)
})

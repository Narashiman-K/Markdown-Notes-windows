/**
 * Runs the gated end-to-end smoke test against the built app and prints a
 * readable summary. Usage: npm run build && npm run smoke
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resultFile = join(root, 'out', 'smoke', 'result.json')

// The `electron` package exports the absolute path to the binary. Spawning it
// directly avoids a shell, which would mangle paths containing spaces.
const require = createRequire(pathToFileURL(join(root, 'package.json')))
const electron = require('electron')

const run = spawnSync(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MARKNOTE_SMOKE: '1', NODE_ENV: 'development' }
})

if (!existsSync(resultFile)) {
  console.error('Smoke test produced no result file. Did `npm run build` succeed?')
  process.exit(1)
}

const report = JSON.parse(readFileSync(resultFile, 'utf8'))
for (const r of report.results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? `  (${r.detail})` : ''}`)
}
console.log(`\n${report.passed} passed, ${report.failed} failed`)
process.exit(report.failed > 0 || run.status !== 0 ? 1 : 0)

/**
 * Runs the gated end-to-end smoke test against the built app and prints a
 * readable summary. Usage: npm run build && npm run smoke
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resultFile = join(root, 'out', 'smoke', 'result.json')

// The `electron` package exports the absolute path to the binary. Spawning it
// directly avoids a shell, which would mangle paths containing spaces.
const require = createRequire(pathToFileURL(join(root, 'package.json')))
const electron = require('electron')

/*
 * The previous run's results are deleted before starting.
 *
 * This script only checked that the file existed, so a run where the app
 * crashed, or never reached the end, cheerfully reported the last successful
 * run instead — a green light for a build that did not happen. That is worse
 * than a failure, and it is why this suite appeared to pass locally while
 * failing in CI on the very same commit.
 */
rmSync(resultFile, { force: true })

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

/*
 * Repeat the failures at the very end.
 *
 * Sixty-five lines of PASS scroll a single FAIL into the middle of a CI log,
 * where a web view truncates it and the summary page does not show it at all.
 * This cost a day of guessing at which assertion had broken, on a workflow
 * that had been red for a month without anyone being able to see why. The
 * last thing printed should be the thing that went wrong.
 */
const failures = report.results.filter((r) => !r.ok)
if (failures.length) {
  console.log('\n' + '='.repeat(64))
  console.log(`FAILED (${failures.length}):`)
  for (const f of failures) {
    console.log(`  ${f.step}`)
    console.log(`    got: ${f.detail ? JSON.stringify(f.detail) : '(no detail recorded)'}`)
  }
  console.log('='.repeat(64))
}

process.exit(report.failed > 0 || run.status !== 0 ? 1 : 0)

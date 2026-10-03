/**
 * Hostile-input tests for the converters, as in the MCP package's
 * tests/security.test.mjs.
 *
 * Every document the app reads comes from somewhere the user does not control
 * (an email attachment, a download, a shared drive), so the parsers are the
 * attack surface. What these pin:
 *   - the spreadsheet library is the patched release (prototype pollution,
 *     CVE-2023-30533, and the 2024 ReDoS are fixed from 0.20.2), installed from
 *     vendor/, so a future `npm install xlsx` that pulls 0.18.5 from the npm
 *     registry fails here rather than shipping;
 *   - a workbook built to pollute Object.prototype leaves it untouched;
 *   - spreadsheets cut off part-way, and corrupt or misnamed files, fail cleanly
 *     and quickly instead of throwing or hanging.
 *
 * Kept identical to the copy in the Windows app, apart from import paths.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { convertSheet, convertPptx } from '../src/renderer/src/lib/convert/office'

const root = join(__dirname, '..')

function newerOrEqual(version: string, floor: string): boolean {
  const a = version.split('.').map(Number)
  const b = floor.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

/** A small real workbook, built here so the test needs no generated samples. */
function workbook(rows: unknown[][], sheetName = 'Data'): Uint8Array {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName)
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

const real = workbook([
  ['Region', 'Revenue', 'Margin'],
  ['North', 4820000, 0.18],
  ['South', 3910000, 0.16]
])

/*
 * A note on timing: a parser stuck in a synchronous loop never yields, so no
 * timer can fail these tests. A regression shows up as the run hanging, which
 * is how the truncated-spreadsheet hang was found in the first place. Each
 * call here is synchronous for the same reason.
 */
describe('converter security', () => {
  it('uses the patched spreadsheet library, installed from vendor/', () => {
    const advice =
      '0.18.5 is the last version on the npm registry and is vulnerable; install from vendor/ ' +
      '(see package.json), never `npm install xlsx`.'
    expect(newerOrEqual(XLSX.version, '0.20.2'), `installed xlsx is ${XLSX.version}. ${advice}`).toBe(true)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const spec = manifest.dependencies?.xlsx ?? manifest.devDependencies?.xlsx
    expect(spec, advice).toMatch(/^file:vendor\/xlsx-0\.2\d\.\d+\.tgz$/)
  })

  it('leaves Object.prototype untouched by a workbook built to pollute it', () => {
    const hostile = workbook(
      [
        ['__proto__', 'constructor', 'prototype', 'polluted'],
        ['{"polluted":true}', 'x', 'y', 'z']
      ],
      '__proto__'
    )
    const before = Object.getOwnPropertyNames(Object.prototype).sort()
    const r = convertSheet(hostile, 'hostile.xlsx')
    expect(r.ok).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before)
    // The names are data, and still shown: hiding them would hide what the
    // file actually contains.
    if (r.ok) expect(r.markdown).toContain('__proto__')
  })

  it.each([10, 16, 30, 45, 120, real.length >> 1])('refuses a spreadsheet cut off at %i bytes', (length) => {
    // These prefixes made XLSX.read spin forever in 0.18.5 and 0.20.3 alike.
    const r = convertSheet(real.slice(0, length), 'cut-off.xlsx')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/incomplete|cut off/i)
  })

  it.skip('does not hang on a fragment carrying a genuine end record (KNOWN GAP until Phase 1b)', () => {
    // SheetJS loops forever on a 10-byte prefix of a real workbook followed by
    // its real end-of-central-directory record; the truncation guard cannot
    // see it, because the record is there. Only parsing in a worker with a
    // time limit can interrupt that. Remove the skip when Phase 1b lands.
    let at = real.length - 22
    while (at >= 0 && !(real[at] === 0x50 && real[at + 1] === 0x4b && real[at + 2] === 5 && real[at + 3] === 6)) at--
    const tail = real.slice(at)
    const crafted = new Uint8Array(10 + tail.length)
    crafted.set(real.slice(0, 10))
    crafted.set(tail, 10)
    expect(convertSheet(crafted, 'crafted.xlsx').ok).toBe(false)
  })

  const garbage = new Uint8Array(64 * 1024).map((_, i) => (i * 2654435761) >>> 24)

  it.each([
    ['random bytes as .xlsx', () => convertSheet(garbage, 'junk.xlsx')],
    ['an empty .xlsx', () => convertSheet(new Uint8Array(0), 'empty.xlsx')]
  ])('fails cleanly on %s', (_label, run) => {
    // Resolving with ok:false, or a readable result, is the contract. A throw
    // is caught one level up in convertToMarkdown and reported, so it is
    // acceptable here too; hanging is not.
    try {
      const r = run()
      expect(typeof r.ok).toBe('boolean')
    } catch (err) {
      expect(String(err)).not.toBe('')
    }
  })

  it('fails cleanly on random bytes as .pptx', async () => {
    await expect(convertPptx(garbage, 'junk.pptx')).rejects.toBeTruthy()
  })
})

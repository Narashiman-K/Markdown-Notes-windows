import { describe, it, expect } from 'vitest'
import { normaliseMarkdown, cell, toTable, titleFrom, tidy } from '../src/renderer/src/lib/convert/normalise'
import { decodeText, splitDelimited, convertText } from '../src/renderer/src/lib/convert/text'
import { extensionOf, isConvertible, needsOcr, isNative, needsTranscription } from '../src/shared/formats'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('normaliseMarkdown', () => {
  it('flattens indentation that Markdown would read as a code block', () => {
    const input = 'Report\n\n    Revenue grew this year.\n    Costs stayed flat.\n'
    const out = normaliseMarkdown(input)
    expect(out).toContain('Revenue grew this year.')
    expect(out).not.toMatch(/^ {4}Revenue/m)
  })

  it('flattens tab indentation too', () => {
    expect(normaliseMarkdown('Title\n\n\tTabbed line here.\n')).not.toMatch(/^\t/m)
  })

  it('leaves fenced code blocks completely alone', () => {
    const input = 'Text\n\n```python\n    indented = True\n    nested()\n```\n'
    const out = normaliseMarkdown(input)
    expect(out).toContain('    indented = True')
    expect(out).toContain('    nested()')
  })

  it('keeps list items readable but under the code-block threshold', () => {
    const out = normaliseMarkdown('Intro\n\n        1. First item\n        2. Second item\n')
    const line = out.split('\n').find((l) => l.includes('First item'))!
    expect(line.length - line.trimStart().length).toBeLessThan(4)
    expect(line.trim()).toBe('1. First item')
  })

  it('preserves shallow indentation used for nested lists', () => {
    const input = '- parent\n  - child\n'
    expect(normaliseMarkdown(input)).toContain('  - child')
  })

  it('collapses runaway blank lines', () => {
    expect(normaliseMarkdown('a\n\n\n\n\n\nb\n')).toBe('a\n\n\nb\n')
  })

  it('is idempotent', () => {
    const once = normaliseMarkdown('Title\n\n    body text\n')
    expect(normaliseMarkdown(once)).toBe(once)
  })
})

describe('table helpers', () => {
  it('escapes pipes and newlines so a cell cannot break the row', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c')
    expect(cell(null)).toBe('')
    expect(cell(42)).toBe('42')
  })

  it('builds a table with a header and separator', () => {
    const md = toTable([['Name', 'Qty'], ['Widget', 10]])
    expect(md.split('\n')).toEqual(['| Name | Qty |', '| --- | --- |', '| Widget | 10 |'])
  })

  it('pads short rows to a consistent width', () => {
    const md = toTable([['A', 'B', 'C'], ['1']])
    expect(md.split('\n')[2]).toBe('| 1 |  |  |')
  })

  it('returns nothing for an empty grid', () => {
    expect(toTable([[], ['', '']])).toBe('')
  })
})

describe('titleFrom / tidy', () => {
  it('derives a readable title from a file name', () => {
    expect(titleFrom('quarterly_sales-report.pdf')).toBe('quarterly sales report')
    expect(titleFrom('.md')).toBe('Document')
  })

  it('joins parts without runaway blank lines', () => {
    expect(tidy(['# A', '', 'body'])).toBe('# A\n\nbody')
  })
})

describe('decodeText', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('hello')])
    expect(decodeText(bytes)).toBe('hello')
  })

  it('reads UTF-16 little-endian', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])
    expect(decodeText(bytes)).toBe('hi')
  })

  it('falls back to windows-1252 for invalid UTF-8', () => {
    // 0x92 is a curly apostrophe in cp1252 and invalid on its own in UTF-8.
    expect(decodeText(new Uint8Array([0x49, 0x74, 0x92, 0x73]))).toBe('It’s')
  })

  it('maps the cp1252 punctuation range Word documents are full of', () => {
    // em dash, ellipsis, curly double quotes, bullet
    expect(decodeText(new Uint8Array([0x97, 0x85, 0x93, 0x94, 0x95]))).toBe('—…“”•')
  })

  it('leaves valid UTF-8 alone', () => {
    expect(decodeText(new TextEncoder().encode('héllo — wörld'))).toBe('héllo — wörld')
  })
})

describe('splitDelimited', () => {
  it('respects quoted fields containing the delimiter', () => {
    expect(splitDelimited('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
  })

  it('handles escaped quotes', () => {
    expect(splitDelimited('"say ""hi""",x', ',')).toEqual(['say "hi"', 'x'])
  })

  it('handles tabs', () => {
    expect(splitDelimited('a\tb\tc', '\t')).toEqual(['a', 'b', 'c'])
  })
})

describe('convertText', () => {
  it('passes Markdown through untouched', () => {
    const src = '# Existing\n\nAlready markdown.\n'
    const r = convertText(enc(src), 'notes.md')
    expect(r.ok && r.markdown).toBe(src)
  })

  it('turns CSV into a table', () => {
    const r = convertText(enc('Name,Qty\nWidget,10\n'), 'stock.csv')
    expect(r.ok && r.markdown).toContain('| Name | Qty |')
    expect(r.ok && r.markdown).toContain('| Widget | 10 |')
  })

  it('fences source code with the right language', () => {
    const r = convertText(enc('print("hi")\n'), 'script.py')
    expect(r.ok && r.markdown).toContain('```py')
    expect(r.ok && r.markdown).toContain('print("hi")')
  })

  it('strips timestamps from subtitles', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nHello there\n\n2\n00:00:05,000 --> 00:00:07,000\nSecond line\n'
    const r = convertText(enc(srt), 'movie.srt')
    expect(r.ok && r.markdown).toContain('Hello there')
    expect(r.ok && r.markdown).not.toContain('-->')
    expect(r.ok && r.markdown).not.toMatch(/^\d+$/m)
  })

  it('adds a title to plain prose that has none', () => {
    const r = convertText(enc('Just some text.\n'), 'notes.txt')
    expect(r.ok && r.markdown).toMatch(/^# notes/)
  })

  it('keeps an existing heading structure', () => {
    const r = convertText(enc('# Mine\n\nbody\n'), 'notes.txt')
    expect(r.ok && r.markdown.startsWith('# Mine')).toBe(true)
  })

  it('rejects an empty file', () => {
    expect(convertText(enc('   \n'), 'empty.txt').ok).toBe(false)
  })
})

describe('format registry', () => {
  it('classifies extensions', () => {
    expect(extensionOf('a/b/report.PDF')).toBe('pdf')
    expect(isNative('notes.md')).toBe(true)
    expect(isNative('report.pdf')).toBe(false)
    expect(needsOcr('scan.PNG')).toBe(true)
    expect(needsOcr('report.docx')).toBe(false)
  })

  it('covers every format the converter claims to support', () => {
    const supported = ['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'odt', 'ods', 'epub', 'csv', 'txt', 'png', 'jpg', 'mp3', 'wav', 'm4a']
    for (const f of supported) {
      expect(isConvertible(`file.${f}`), `.${f} should be convertible`).toBe(true)
    }
    expect(isConvertible('archive.zip')).toBe(false)
    expect(isConvertible('program.exe')).toBe(false)
  })

  it('separates audio, which is the only cloud-only format', () => {
    expect(needsTranscription('interview.mp3')).toBe(true)
    expect(needsTranscription('meeting.WAV')).toBe(true)
    // Everything else must be convertible without a network connection.
    expect(needsTranscription('report.pdf')).toBe(false)
    expect(needsTranscription('scan.png')).toBe(false)
  })
})

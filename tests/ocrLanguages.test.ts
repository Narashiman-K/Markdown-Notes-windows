import { describe, it, expect } from 'vitest'
import { BUILT_IN_OCR_LANGUAGES, normaliseOcrLanguages, describeOcrLanguages, tidyOcrText, keepOcrLineBreaks } from '../src/renderer/src/lib/ocrLanguages'
// @ts-expect-error — a plain .mjs build script, imported for its list only
import { LANGUAGES } from '../scripts/tesseract-assets.mjs'

describe('offline OCR languages', () => {
  it('offers exactly the languages the build packages', () => {
    // A language in the picker without a staged model would fail only when a
    // user chose it; one staged but not offered would be dead weight.
    expect(BUILT_IN_OCR_LANGUAGES.map((l) => l.code)).toEqual(LANGUAGES)
  })

  it('cleans a saved choice: unknown codes dropped, order fixed, never empty', () => {
    expect(normaliseOcrLanguages(['hin', 'eng', 'xyz'])).toEqual(['eng', 'hin'])
    expect(normaliseOcrLanguages([])).toEqual(['eng'])
    expect(normaliseOcrLanguages(undefined)).toEqual(['eng'])
    expect(normaliseOcrLanguages('kan')).toEqual(['eng'])
  })

  it('names a choice the way a sentence would', () => {
    expect(describeOcrLanguages(['kan'])).toBe('Kannada')
    expect(describeOcrLanguages(['eng', 'kan'])).toBe('English and Kannada')
    expect(describeOcrLanguages(['eng', 'kan', 'hin'])).toBe('English, Kannada and Hindi')
  })
})

describe('tidyOcrText', () => {
  it('reads a zero after a Kannada letter as the anusvara', () => {
    expect(tidyOcrText('ಬೆ೦ಗಳೂರು')).toBe('ಬೆಂಗಳೂರು')
  })
  it('does the same in Devanagari', () => {
    expect(tidyOcrText('हि०दी')).toBe('हिंदी')
  })
  it('leaves real numbers alone', () => {
    expect(tidyOcrText('೧೦ ಮತ್ತು ೦')).toBe('೧೦ ಮತ್ತು ೦')
    expect(tidyOcrText('१०० रुपये')).toBe('१०० रुपये')
    expect(tidyOcrText('Room 10')).toBe('Room 10')
  })
})

describe('keepOcrLineBreaks', () => {
  it('ends every continuing line of a paragraph with a hard break', () => {
    expect(keepOcrLineBreaks('Key figures:\nTotal revenue 4,820,000\nOpen incidents 7')).toBe(
      'Key figures:\\\nTotal revenue 4,820,000\\\nOpen incidents 7'
    )
  })
  it('keeps paragraphs apart and drops runs of blank lines', () => {
    expect(keepOcrLineBreaks('One\ntwo\n\n\n\nThree')).toBe('One\\\ntwo\n\nThree')
  })
  it('leaves single lines and trailing spaces tidy', () => {
    expect(keepOcrLineBreaks('Alone   ')).toBe('Alone')
  })
})

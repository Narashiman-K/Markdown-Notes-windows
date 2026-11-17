// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { applyState, buildTree, EMPTY_STATE, readState, type MapState } from '../src/renderer/src/lib/mindmap'
import { answer, deck, highlightCards, parseQA, progressOf, quizOrder, search, setQA, toAnki, toCsv, toggleTag } from '../src/renderer/src/lib/study'

const BOOK = `# Book

## Chapter One

Small talk opens the door to friendship, and most people find it awkward at first but improve with practice.

Curiosity keeps a conversation going: ask one more question than feels natural, then listen closely.

## Chapter Two

First impressions form within seconds, so a warm greeting and open posture matter more than clever words.
`

const fresh = (): MapState => readState(JSON.stringify(EMPTY_STATE))

describe('study cards', () => {
  const tree = buildTree(BOOK, 'Book.md')

  it('makes a card per chapter and paragraph, with a simple question', () => {
    const cards = deck(tree, fresh())
    expect(cards.length).toBeGreaterThanOrEqual(4)
    expect(cards[0].chapter).toBe('Chapter One')
    expect(cards.every((c) => c.q && c.a)).toBe(true)
  })

  it('uses your own question and remembers quiz answers', () => {
    let s = fresh()
    const first = deck(tree, s)[0]
    s = setQA(s, first.id, { q: 'Why small talk?', a: 'It opens the door.' })
    s = answer(s, first.id, false, 10)
    const again = deck(tree, s)
    expect(again[0].q).toBe('Why small talk?')
    expect(progressOf(again)).toMatchObject({ asked: 1, known: 0 })
    // Never-asked cards come first, then the one not known.
    const order = quizOrder(again)
    expect(order[order.length - 1].id).toBe(first.id)
  })

  it('tags and searches', () => {
    let s = fresh()
    const c = deck(tree, s).find((x) => /impressions/i.test(x.node.card.summary + x.node.card.idea))!
    s = toggleTag(s, c.id, '⭐ Important')
    const all = deck(tree, s)
    expect(search(all, 'greeting').map((x) => x.id)).toContain(c.id)
    expect(search(all, 'important').map((x) => x.id)).toContain(c.id)
    s = toggleTag(s, c.id, '⭐ Important')
    expect(s.tags?.[c.id]).toBeUndefined()
  })

  it('turns highlights into cards under their section', () => {
    const src = BOOK.replace('a warm greeting', '<mark class="mn-a mn-highlight" data-mn-id="h1" data-mn-type="highlight" data-mn-note="Smile!">a warm greeting</mark>')
    const t = buildTree(src, 'Book.md')
    const add = highlightCards(src, t, fresh())
    expect(add).toHaveLength(1)
    expect(add[0]).toMatchObject({ id: 'hl-h1', idea: 'a warm greeting', summary: 'Smile!' })
    const two = t.children.find((c) => c.title === 'Chapter Two')!
    expect(add[0].parent).toBe(two.id)
    const s = { ...fresh(), custom: add }
    expect(highlightCards(src, applyState(t, s), s)).toHaveLength(0)
  })

  it('exports for Anki and spreadsheets', () => {
    const cards = deck(tree, fresh())
    const anki = toAnki(cards, 'Book')
    expect(anki.split('\n')[0]).toBe('#separator:Tab')
    expect(anki).toContain('Chapter_One')
    const csv = toCsv(cards)
    expect(csv.startsWith('﻿Chapter,Card,Question,Answer,Tags,Known')).toBe(true)
  })

  it('reads AI answers that come wrapped in text', () => {
    expect(parseQA('Sure! {"a1": {"q": "Why?", "a": "Because."}} Hope that helps')).toEqual({ a1: { q: 'Why?', a: 'Because.' } })
    expect(parseQA('not json')).toEqual({})
  })
})

describe('study questions are about the book', () => {
  it('skips the contents and promotion pages, and asks fill-the-gap questions', async () => {
    const { buildTree, readState } = await import('../src/renderer/src/lib/mindmap')
    const { deck } = await import('../src/renderer/src/lib/study')
    const md = '# Book\n\n## Table of Contents\n\nChapter 1 Intro Chapter 2 More Chapter 3 End\n\n## Bonus\n\nCLICK HERE to download your FREE copy now from www.example.com today please.\n\n## Chapter 1\n\nCuriosity keeps a conversation going: ask one more question than feels natural, then listen closely to the answer.\n'
    const cards = deck(buildTree(md, 'Book.md'), readState(''))
    expect(cards.some((c) => /contents|click here/i.test(c.title + c.a))).toBe(false)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((c) => !/chapter, stories, contents/i.test(c.q))).toBe(true)
  })
})

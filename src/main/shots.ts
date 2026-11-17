/**
 * Store screenshot generator. Runs only when MARKNOTE_SHOTS=1.
 *
 * Hand-captured screenshots pick up stray hover tooltips and whatever window
 * size the machine happened to have. This drives the real app through each
 * scenario at a fixed 1920x1080, moves the pointer out of the way, and captures
 * clean frames — reproducible, and correctly sized for the Microsoft Store.
 */
import { app, BrowserWindow } from 'electron'
import { tmpdir } from 'node:os'
import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runShots(win: BrowserWindow, outDir: string): Promise<void> {
  const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>
  const log: string[] = []

  const shot = async (name: string, note: string): Promise<void> => {
    // Park the pointer off-canvas so no hover state is captured.
    await js<boolean>(`(() => {
      document.querySelectorAll('.note-tip, .sel-toolbar, .format-toolbar').forEach(el => el.remove());
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: -50, clientY: -50 }));
      return true;
    })()`)
    await wait(500)
    const img = await win.webContents.capturePage()
    await fsp.writeFile(join(outDir, name), img.toPNG())
    log.push(`${name}  —  ${note}`)
  }

  try {
    await fsp.mkdir(outDir, { recursive: true })
    win.setSize(1920, 1080)
    win.center()
    await wait(1500)

    // MARKNOTE_SHOTS_ONLY=1.3: just the 1.3.0 screenshots, in their own folder.
    if (process.env['MARKNOTE_SHOTS_ONLY'] === '1.3') {
      // The window renders off screen (index.ts); keep its timers at full speed.
      win.webContents.setBackgroundThrottling(false)
      win.webContents.setFrameRate(30)
      const dir13 = join(outDir, '1.3.0')
      await fsp.mkdir(dir13, { recursive: true })
      const shot13 = async (name: string, note: string): Promise<void> => {
        await wait(500)
        // capturePage now and then fails with UnknownVizError; try again.
        let img: Electron.NativeImage | null = null
        for (let i = 0; i < 6 && !img; i++) {
          try {
            img = await win.webContents.capturePage()
          } catch {
            await wait(800)
          }
        }
        if (!img) {
          log.push(`${name}  —  capture failed`)
          return
        }
        await fsp.writeFile(join(dir13, name), img.toPNG())
        log.push(`${name}  —  ${note}`)
      }
      await shots13(win, js, shot13)
      await fsp.writeFile(join(dir13, 'README.txt'), log.join('\n') + '\n', 'utf8')
      app.exit(0)
      return
    }

    const demo = join(app.getAppPath(), 'samples', 'demo.md').replace(/\\/g, '\\\\')

    /* 1 — the core idea: a real document, annotated, with the panel open */
    // A copy, so AutoSave writes the annotations into it, not into the sample.
    const demoCopy = join(tmpdir(), 'demo.md')
    await fsp.copyFile(join(app.getAppPath(), 'samples', 'demo.md'), demoCopy)
    win.webContents.send('menu:action', { action: 'file:openPath', payload: demoCopy })
    await wait(2000)

    // Annotate several passages the way a reader actually would.
    await js<boolean>(`(async () => {
      const findText = (needle) => {
        const walker = document.createTreeWalker(document.querySelector('.markdown-body'), NodeFilter.SHOW_TEXT);
        let n; while (n = walker.nextNode()) { const i = n.nodeValue.indexOf(needle); if (i >= 0) return [n, i]; }
        return null;
      };
      const select = (needle) => {
        const hit = findText(needle); if (!hit) return false;
        const r = document.createRange();
        r.setStart(hit[0], hit[1]); r.setEnd(hit[0], hit[1] + needle.length);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        return true;
      };
      const click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); };
      const pause = (ms) => new Promise(r => setTimeout(r, ms));

      if (select('driven almost entirely by the')) { await pause(350); click('.sel-toolbar .swatch'); await pause(500); }
      if (select('outperformed')) { await pause(350); const sw = document.querySelectorAll('.sel-toolbar .swatch'); if (sw[1]) sw[1].click(); await pause(500); }
      if (select('single Colombian supplier represents 41% of volume')) {
        await pause(350);
        const btns = [...document.querySelectorAll('.sel-toolbar button')];
        const u = btns.find(b => b.title && b.title.startsWith('Underline'));
        if (u) u.click();
        await pause(500);
      }
      return true;
    })()`)
    await wait(1200)

    // Open the annotations panel.
    await js<boolean>(`(() => { [...document.querySelectorAll('.tb')].find(b => b.title.startsWith('Annotations'))?.click(); return true })()`)
    await wait(900)
    await shot('01-annotate.png', 'Reading and annotating, with the annotations panel')

    /* 2 — outline panel on a structured document */
    await js<boolean>(`(() => { [...document.querySelectorAll('.tb')].find(b => b.title.startsWith('Outline'))?.click(); return true })()`)
    await wait(900)
    await shot('02-outline.png', 'Outline panel for navigating long documents')

    /* 3 — edit mode with live preview */
    await js<boolean>(`(() => { [...document.querySelectorAll('.segmented button')].find(b => b.textContent === 'Edit')?.click(); return true })()`)
    await wait(1600)
    await shot('03-edit.png', 'Source editor with live preview')

    /* 4 — the converter */
    await js<boolean>(`(() => { [...document.querySelectorAll('.segmented button')].find(b => b.textContent === 'View')?.click(); return true })()`)
    await wait(700)
    win.webContents.send('menu:action', { action: 'convert:open' })
    await wait(1400)
    await shot('04-convert.png', 'Converting documents to Markdown, entirely offline')
    await js<boolean>(`(() => { [...document.querySelectorAll('.convert-modal .modal-actions button')].find(b => b.textContent === 'Close')?.click(); return true })()`)
    await wait(600)

    /* 5 — AI panel with a genuine answer and citations */
    if (process.env['MARKNOTE_SHOTS_NO_AI'] !== '1') {
    win.webContents.send('menu:action', { action: 'ai:toggle' })
    await wait(1500)

    const asked = await js<boolean>(`(() => {
      const ta = document.querySelector('.ai-composer textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'What risks does the report list, and what does it recommend?');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)

    if (asked) {
      await js<boolean>(`(() => { [...document.querySelectorAll('.ai-send-row button')].find(b => b.textContent === 'Ask')?.click(); return true })()`)
      // A local model needs time to load and answer.
      for (let i = 0; i < 100; i++) {
        await wait(3000)
        const done = await js<boolean>(`!!document.querySelector('.ai-turn.assistant .ai-answer')`)
        if (done) break
      }
      await wait(1500)

      // The panel auto-scrolls to the newest content, which can push the answer
      // itself out of frame. Bring the start of the answer back into view.
      await js<boolean>(`(() => {
        const turn = [...document.querySelectorAll('.ai-turn.user')].pop();
        if (turn) turn.scrollIntoView({ block: 'start' });
        return true;
      })()`)
      await wait(900)
    }
    await shot('05-ai.png', 'Asking questions about your documents, answered with citations')
    win.webContents.send('menu:action', { action: 'ai:toggle' })
    await wait(600)
    }

    await newShots(win, js, shot)

    await fsp.writeFile(join(outDir, 'README.txt'), log.join('\n') + '\n', 'utf8')
  } catch (err) {
    await fsp.writeFile(join(outDir, 'error.txt'), String((err as Error)?.stack ?? err), 'utf8')
  }
  app.exit(0)
}

/**
 * The 1.2.0 features: Compare documents, Reader mode, and a converted PDF with
 * its pictures in page view. Uses the files in Compare-Test-Samples beside the
 * project, and a second window as the other side of the comparison, so no
 * file dialog is needed.
 */
async function newShots(
  win: BrowserWindow,
  js: <T>(code: string) => Promise<T>,
  shot: (name: string, note: string) => Promise<void>
): Promise<void> {
  const samples = join(dirname(app.getAppPath()), 'Compare-Test-Samples')
  const open = (w: BrowserWindow, path: string): void => w.webContents.send('menu:action', { action: 'file:openPath', payload: path })

  /* 6 — Compare documents, side by side */
  open(win, join(samples, '01-contract-v1.md'))
  await wait(1800)
  const before = new Set(BrowserWindow.getAllWindows())
  await js<boolean>(`window.api.newWindow().then(() => true)`)
  await wait(2500)
  const other = BrowserWindow.getAllWindows().find((w) => !before.has(w))
  if (other) {
    open(other, join(samples, '02-contract-v2.md'))
    await wait(2000)
    other.hide()
    win.focus()
    await wait(500)
    await js<boolean>(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.toolbar button')].find(b => /Compare/.test(b.textContent))?.click();
      await pause(1500);
      document.querySelectorAll('.cmp-mode')[0]?.click();
      await pause(400);
      const d = document.querySelector('.compare-choose details'); if (d) d.open = true;
      await pause(200);
      [...document.querySelectorAll('.compare-choose .compare-source')].find(b => /02-contract-v2/.test(b.textContent))?.click();
      await pause(1500);
      return true;
    })()`)
    await wait(800)
    await shot('06-compare.png', 'Compare documents: every difference, side by side, with the changed words marked')

    await js<boolean>(`(() => { [...document.querySelectorAll('.segmented button')].find(b => b.textContent === 'Inline')?.click(); return true })()`)
    await wait(800)
    await shot('07-compare-inline.png', 'Compare documents: inline view, like tracked changes')
    await js<boolean>(`(() => { [...document.querySelectorAll('.cmp-actions button')].find(b => b.textContent === 'Close')?.click(); return true })()`)
    await wait(800)
    other.destroy()
  }

  /* 8 — Reader mode, sepia */
  open(win, join(tmpdir(), 'demo.md'))
  await wait(1800)
  win.webContents.send('menu:action', { action: 'view:reader' })
  await wait(1200)
  await js<boolean>(`(() => { [...document.querySelectorAll('.reader-palette')].find(b => /Sepia/i.test(b.textContent))?.click(); return true })()`)
  await wait(900)
  await shot('08-reader.png', 'Reader mode: text size, line width, spacing and page colours')
  win.webContents.send('menu:action', { action: 'view:reader' })
  await wait(900)

  /* 9 — a PDF converted with its pictures, in page view */
  const pdf = join(app.getAppPath(), 'samples', 'sample-pictures.pdf').replace(/\\/g, '\\\\')
  const md = await js<string>(`(async () => {
    for (let i = 0; i < 50 && !window.__convert; i++) await new Promise(r => setTimeout(r, 200));
    const r = await window.api.readBytes("${pdf}");
    const c = await window.__convert.convertToMarkdown(new Uint8Array(r.bytes), "sample-pictures.pdf", {});
    return c.ok ? c.markdown : '';
  })()`)
  if (md) {
    const out = join(tmpdir(), 'Quarterly report (from PDF).md')
    await fsp.writeFile(out, md, 'utf8')
    open(win, out)
    await wait(2000)
    // A converted PDF opens in page view by itself; close the side panel left
    // open by the earlier shots and start at the top.
    await js<boolean>(`(() => {
      document.querySelector('.sidebar button[title="Close panel"]')?.click();
      document.querySelector('.preview-scroll')?.scrollTo(0, 0);
      return true;
    })()`)
    await wait(1500)
    await shot('09-pdf-pictures-page-view.png', 'A PDF converted to Markdown with its pictures, shown at its original page size')
  }
}

/**
 * The 1.3.0 features, in the dark theme, on an original sample book
 * (samples/store-book.md): Doc Editor, read aloud, mind map and Study, reader
 * mode with Listen, table editor, diagrams and version history.
 */
async function shots13(
  win: BrowserWindow,
  js: <T>(code: string) => Promise<T>,
  shot: (name: string, note: string) => Promise<void>
): Promise<void> {
  // A failed step is written down and the run carries on to the next scene.
  const trace: string[] = []
  const raw = js
  let step = 0
  js = (async (code: string) => {
    step++
    try {
      const r = await raw(code)
      trace.push(`${step}: ${JSON.stringify(r)}`)
      return r
    } catch (e) {
      trace.push(`${step}: ERROR ${String(e)} :: ${code.slice(0, 120).replace(/\s+/g, ' ')}`)
      return undefined
    } finally {
      await fsp.writeFile(join(app.getAppPath(), 'store-screenshots', '1.3.0', 'trace.txt'), trace.join('\n'), 'utf8').catch(() => undefined)
    }
  }) as typeof js
  const realShot = shot
  shot = async (name, note) => {
    await realShot(name, note)
    await fsp.writeFile(join(app.getAppPath(), 'store-screenshots', '1.3.0', 'trace.txt'), trace.join('\n'), 'utf8')
  }
  const send = (action: string, payload?: unknown): void => win.webContents.send('menu:action', { action, payload })
  const bookDir = join(tmpdir(), `marknote-shots-${Date.now()}`)
  await fsp.mkdir(bookDir, { recursive: true })
  const book = join(bookDir, 'Learning That Lasts.md')
  await fsp.copyFile(join(app.getAppPath(), 'samples', 'store-book.md'), book)
  const clean = `(() => {
    document.querySelectorAll('.note-tip, .sel-toolbar, .format-toolbar').forEach(el => el.remove());
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: -50, clientY: -50 }));
    return true; })()`

  // Read aloud is "ready" once the voice is downloaded and it is playing.
  const readyToShow = `(() => { const p = document.querySelector('.read-panel');
    return !!p && !/Download|Preparing|Loading|Starting/i.test(p.textContent) && !!p.querySelector('.read-play.on') })()`
  trace.push(`size ${JSON.stringify(win.getSize())} content ${JSON.stringify(win.getContentSize())}`)
  send('view:theme:dark')
  send('file:openPath', book)
  await wait(2500)

  /* 1 — Doc Editor with the right-click menu */
  send('view:mode:doc')
  await wait(1800)
  await js<boolean>(`(() => {
    const all = [...document.querySelectorAll('.doc-block')];
    const block = all.find(b => /Rereading feels productive/.test(b.textContent));
    if (!block) return 'blocks=' + all.length + ' ' + all.slice(0, 4).map(b => b.textContent.slice(0, 30)).join(' | ');
    block.scrollIntoView({ block: 'start' }); block.closest('.doc-page')?.scrollBy(0, -90);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n; while (n = walker.nextNode()) { const i = n.nodeValue.indexOf('familiarity'); if (i >= 0) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 11);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const rect = r.getBoundingClientRect();
      block.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.bottom + 4 }));
      return true; } }
    return false; })()`)
  await wait(900)
  await shot('01-doc-editor.png', 'Doc Editor: write formatted text like a word processor, with a right-click menu; the file stays Markdown')
  await js<boolean>(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)
  await wait(500)
  send('view:mode:view')
  await wait(1200)

  /* 2 — Read aloud with the sentence highlighted and the words per minute */
  await js<boolean>(`(() => { const h = [...document.querySelectorAll('.markdown-body h2')].find(e => /Chapter 1/.test(e.textContent)); h?.scrollIntoView({ block: 'start' }); return true })()`)
  await wait(600)
  send('view:readAloud')
  await wait(1200)
  // Silent: the volume slider in the panel's "More" fold-out to zero.
  await js<string>(`(async () => {
    const pause = (ms) => new Promise(r => setTimeout(r, ms));
    const panel = document.querySelector('.read-panel'); if (!panel) return 'no panel';
    panel.querySelector('.dict-summary')?.click(); await pause(400);
    const r = panel.querySelector('.dict-options input[type=range]'); if (!r) return 'no range';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '0');
    r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(200);
    panel.querySelector('.dict-summary')?.click(); await pause(300);
    panel.querySelector('.read-play')?.click();
    return 'ok ' + r.value; })()`)
  for (let i = 0; i < 90; i++) {
    await wait(2000)
    const ok = await js<boolean>(readyToShow)
    if (ok) break
  }
  // Reading for a minute and more, so the measured speed is past the voice's
  // warm-up. The page follows the sentence being read.
  await wait(70000)
  await js<boolean>(clean)
  await shot('02-read-aloud.png', 'Read aloud with natural voices, each sentence highlighted, and your reading speed in words per minute')
  await js<boolean>(`(() => { document.querySelector('.read-panel button[title="Stop"]')?.click(); return true })()`)
  await wait(400)
  send('view:readAloud')
  await wait(600)

  /* 3 — Mind map and the Study quiz */
  send('view:mindmap')
  await wait(2500)
  await js<boolean>(`(async () => {
    const pause = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('.mm-study:not(.on)')?.click();
    await pause(900);
    const show = [...document.querySelectorAll('.st-panel button')].find(b => /Show answer/.test(b.textContent));
    show?.click();
    await pause(500);
    return true; })()`)
  await wait(800)
  await shot('03-mind-map-study.png', 'Mind map of any document, chapter by chapter, with a Study panel: quiz, question cards, tags and Anki export')
  send('view:mindmap')
  await wait(900)

  /* 4 — Reader mode, Sepia, with Listen */
  send('view:reader')
  await wait(1300)
  await js<boolean>(`(() => { [...document.querySelectorAll('.reader-palette')].find(b => /Sepia/i.test(b.textContent))?.click(); return true })()`)
  await wait(500)
  await js<boolean>(`(() => { const h = [...document.querySelectorAll('.markdown-body h2')].find(e => /Chapter 3/.test(e.textContent)); h?.scrollIntoView({ block: 'start' }); document.querySelector('.reader-listen:not(.on)')?.click(); return true })()`)
  await wait(1200)
  await js<boolean>(`(() => { document.querySelector('.read-panel .read-play')?.click(); return true })()`)
  for (let i = 0; i < 30; i++) {
    await wait(1500)
    const ok = await js<boolean>(readyToShow)
    if (ok) break
  }
  // Before the first measurement, so the bar shows the set speed (about 155 wpm).
  await wait(3500)
  await js<boolean>(clean)
  await shot('04-reader-listen.png', 'Reader mode: page colours, text size and spacing, with read aloud built in')
  await js<boolean>(`(() => { document.querySelector('.read-panel button[title="Stop"]')?.click(); return true })()`)
  await wait(400)
  send('view:readAloud')
  await wait(400)
  await js<boolean>(`(() => { [...document.querySelectorAll('.reader-palette')].find(b => /Dark|Night/i.test(b.textContent))?.click(); return true })()`)
  send('view:reader')
  await wait(1000)

  /* 5 — Table editor: the grid popup on the book's table */
  await js<boolean>(`(() => {
    const t = document.querySelector('.markdown-body table'); if (!t) return false;
    t.scrollIntoView({ block: 'center' });
    return true; })()`)
  // Scrolling hides the table buttons, so point at the table only afterwards.
  await wait(700)
  await js<boolean>(`(() => {
    const t = document.querySelector('.markdown-body table'); if (!t) return false;
    const cell = t.querySelector('td'); const r = cell.getBoundingClientRect();
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
    return true; })()`)
  await wait(600)
  await js<boolean>(`(() => { const b = document.querySelector('button[title="Open the table editor"]'); b?.click(); return !!b })()`)
  await wait(1200)
  await js<boolean>(clean)
  await shot('05-table-editor.png', 'Table editor: edit tables in a grid, sort, align and add rows or columns')
  await js<boolean>(`(() => { document.querySelector('.modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)
  await wait(500)
  await js<boolean>(`(() => { [...document.querySelectorAll('.modal.table-editor button')].find(b => /^(Cancel|Close)/.test(b.textContent))?.click(); return true })()`)
  await wait(500)

  /* 6 — Diagram dialog with its live preview */
  send('insert:diagram')
  await wait(2500)
  await js<boolean>(`(() => { const k = document.querySelectorAll('.diagram-kinds button'); k[0]?.click(); return true })()`)
  await wait(2500)
  await shot('06-diagram.png', 'Diagrams: flowcharts, timelines and mind maps drawn from a few lines of text')
  await js<boolean>(`(() => { [...document.querySelectorAll('.modal button')].find(b => /^Cancel/.test(b.textContent))?.click(); return true })()`)
  await wait(600)

  /* 7 — Version history after two saves */
  send('view:mode:edit')
  await wait(1500)
  for (const words of ['\n\nA good night of sleep is part of studying.', '\n\nReview what you learned before bed.']) {
    await js<boolean>(`(() => {
      const c = document.querySelector('.cm-content'); if (!c) return false;
      c.focus();
      document.execCommand('selectAll'); getSelection().collapseToEnd();
      document.execCommand('insertText', false, ${JSON.stringify(words)});
      return true; })()`)
    await wait(700)
    send('file:save')
    await wait(1500)
  }
  send('view:mode:view')
  await wait(900)
  send('file:versions')
  await wait(1800)
  await js<boolean>(`(() => { const b = document.querySelectorAll('.versions-list button'); b[1]?.click(); return true })()`)
  await wait(900)
  await shot('07-version-history.png', 'Version history: every save is kept, so you can compare and restore an earlier version')
}

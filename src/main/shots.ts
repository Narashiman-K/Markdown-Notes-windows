/**
 * Store screenshot generator. Runs only when MARKNOTE_SHOTS=1.
 *
 * Hand-captured screenshots pick up stray hover tooltips and whatever window
 * size the machine happened to have. This drives the real app through each
 * scenario at a fixed 1920x1080, moves the pointer out of the way, and captures
 * clean frames — reproducible, and correctly sized for the Microsoft Store.
 */
import { app, type BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

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

    const demo = join(app.getAppPath(), 'samples', 'demo.md').replace(/\\/g, '\\\\')

    /* 1 — the core idea: a real document, annotated, with the panel open */
    win.webContents.send('menu:action', { action: 'file:openPath', payload: join(app.getAppPath(), 'samples', 'demo.md') })
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
    win.webContents.send('menu:action', { action: 'ai:toggle' })
    await wait(1500)

    const asked = await js<boolean>(`(() => {
      const ta = document.querySelector('.ai-composer textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'What is the biggest risk in this report?');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)

    if (asked) {
      await js<boolean>(`(() => { [...document.querySelectorAll('.ai-send-row button')].find(b => b.textContent === 'Ask')?.click(); return true })()`)
      // A local model needs time to load and answer.
      for (let i = 0; i < 40; i++) {
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

    await fsp.writeFile(join(outDir, 'README.txt'), log.join('\n') + '\n', 'utf8')
  } catch (err) {
    await fsp.writeFile(join(outDir, 'error.txt'), String((err as Error)?.stack ?? err), 'utf8')
  }
  app.exit(0)
}

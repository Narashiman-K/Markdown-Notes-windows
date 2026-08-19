/**
 * End-to-end smoke test. Only runs when MARKNOTE_SMOKE=1 is set, so it never
 * executes for real users. It drives the real renderer through the real
 * preload/IPC bridge and writes screenshots + a JSON result to `out/smoke/`.
 */
import { app, type BrowserWindow } from 'electron'
import { promises as fsp, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runSmoke(win: BrowserWindow, outDir: string): Promise<void> {
  const results: Array<{ step: string; ok: boolean; detail?: string }> = []

  // Written after every check, so a hang leaves a trail showing exactly which
  // step was reached rather than producing no file at all.
  const flush = (): void => {
    const failed = results.filter((r) => !r.ok)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, 'result.json'),
      JSON.stringify(
        { passed: results.length - failed.length, failed: failed.length, complete: false, results },
        null,
        2
      ),
      'utf8'
    )
  }

  const check = (step: string, ok: boolean, detail?: string): void => {
    results.push({ step, ok, detail })
    flush()
  }

  const mark = (step: string): void => {
    results.push({ step: `» ${step}`, ok: true, detail: 'reached' })
    flush()
  }

  const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>

  /** Never let one wedged call freeze the whole suite. */
  const jsWithTimeout = async <T,>(code: string, ms: number, onTimeout: T): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout), ms)
    })
    try {
      return await Promise.race([js<T>(code), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  try {
    await fsp.mkdir(outDir, { recursive: true })
    await wait(1200)

    /* 1 — the welcome document renders */
    const heading = await js<string>(`document.querySelector('.markdown-body h1')?.textContent || ''`)
    check('renders markdown', heading.includes('Welcome to Suprasūtā Markdown Notes'), heading)

    const tableCells = await js<number>(`document.querySelectorAll('.markdown-body table td').length`)
    check('renders tables', tableCells > 0, String(tableCells))

    /* 2 — selecting text shows the floating annotation toolbar */
    await js<boolean>(`(() => {
      const p = [...document.querySelectorAll('.markdown-body p')].find(el => el.textContent.includes('viewer'));
      const node = [...p.childNodes].find(n => n.nodeType === 3 && n.nodeValue.includes('A fast'));
      const r = document.createRange();
      r.setStart(node, 0); r.setEnd(node, 6);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return true;
    })()`)
    await wait(400)
    const toolbarUp = await js<number>(`document.querySelectorAll('.sel-toolbar .swatch').length`)
    check('selection toolbar appears', toolbarUp === 5, String(toolbarUp))

    /* 3 — clicking a swatch writes a highlight into the source */
    await js<boolean>(`(() => { document.querySelector('.sel-toolbar .swatch').click(); return true })()`)
    await wait(500)
    const marks = await js<number>(`document.querySelectorAll('mark.mn-highlight').length`)
    check('highlight applied', marks === 1, String(marks))

    const dirty = await js<string>(`document.querySelector('.statusbar').textContent`)
    check('document marked dirty', dirty.includes('Unsaved changes'), dirty)

    /* 4 — the annotations panel lists it */
    await js<boolean>(`(() => { [...document.querySelectorAll('.tb')].find(b => b.title.startsWith('Annotations')).click(); return true })()`)
    await wait(400)
    const cards = await js<number>(`document.querySelectorAll('.annot-card').length`)
    check('annotation listed in panel', cards === 1, String(cards))

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '01-view-annotated.png'), img.toPNG())
    })

    /* 5 — outline panel lists headings */
    await js<boolean>(`(() => { [...document.querySelectorAll('.tb')].find(b => b.title.startsWith('Outline')).click(); return true })()`)
    await wait(400)
    const outline = await js<number>(`document.querySelectorAll('.outline-item').length`)
    check('outline lists headings', outline >= 2, String(outline))

    /* 6 — zoom (reset first: the level is persisted between runs) */
    await js<boolean>(`(() => { document.querySelector('.zoom-label').click(); return true })()`)
    await wait(250)
    check('zoom reset', (await js<string>(`document.querySelector('.zoom-label').textContent`)) === '100%')
    await js<boolean>(`(() => { [...document.querySelectorAll('.tb')].find(b => b.title.startsWith('Zoom in')).click(); return true })()`)
    await wait(300)
    const zoomLabel = await js<string>(`document.querySelector('.zoom-label').textContent`)
    check('zoom in works', zoomLabel === '110%', zoomLabel)

    /* 7 — edit mode with live preview */
    await js<boolean>(`(() => { [...document.querySelectorAll('.segmented button')].find(b => b.textContent === 'Edit').click(); return true })()`)
    await wait(900)
    const cm = await js<number>(`document.querySelectorAll('.cm-content').length`)
    check('editor mounts', cm === 1, String(cm))
    const livePreview = await js<number>(`document.querySelectorAll('.live-preview .markdown-body').length`)
    check('live preview renders', livePreview === 1, String(livePreview))
    const sourceHasTag = await js<boolean>(`document.querySelector('.cm-content').textContent.includes('data-mn-type="highlight"')`)
    check('annotation is embedded in the markdown source', sourceHasTag)

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '02-edit-mode.png'), img.toPNG())
    })

    /* 8 — selecting in the source editor raises the format toolbar */
    await js<boolean>(`(() => {
      const content = document.querySelector('.cm-content');
      // Use a body line, never the heading: wrapping "# Wel" in ** would break it.
      const line = [...content.querySelectorAll('.cm-line')].find(l => /^\\s*\\d+\\. Press/.test(l.textContent));
      const node = line.firstChild.nodeType === 3 ? line.firstChild : line.querySelector('*').firstChild;
      const r = document.createRange();
      r.setStart(node, 0); r.setEnd(node, Math.min(5, node.nodeValue.length));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      content.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('selectionchange'));
      return true;
    })()`)
    await wait(600)
    const fmtButtons = await js<number>(`document.querySelectorAll('.format-toolbar button').length`)
    check('edit-mode format toolbar appears', fmtButtons >= 16, String(fmtButtons))
    const hasBold = await js<boolean>(`!!document.querySelector('.format-toolbar .ft-bold')`)
    check('format toolbar has insert actions', hasBold)
    const onScreen = await js<boolean>(
      `(() => { const r = document.querySelector('.format-toolbar').getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })()`
    )
    check('format toolbar stays inside the window', onScreen)

    // Pressing Bold must actually edit the source. CodeMirror only renders the
    // visible lines, so measure via the status bar's character count, which is
    // driven by application state rather than the virtualised DOM.
    const charCount = async (): Promise<number> =>
      Number((/(\d+) chars/.exec(await js<string>(`document.querySelector('.statusbar').textContent`)) ?? [])[1] ?? -1)

    const beforeBold = await charCount()
    await js<boolean>(`(() => { document.querySelector('.format-toolbar .ft-bold').click(); return true })()`)
    await wait(500)
    const afterBold = await charCount()
    check('format toolbar bold edits the document', afterBold === beforeBold + 4, `${beforeBold} -> ${afterBold}`)

    // Undo via the editor's own history, so later screenshots show a clean doc.
    win.webContents.send('menu:action', { action: 'edit:undo' })
    await wait(500)
    const afterEditorUndo = await charCount()
    check('editor undo still works in edit mode', afterEditorUndo === beforeBold, `${afterBold} -> ${afterEditorUndo}`)

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '03-edit-format-toolbar.png'), img.toPNG())
    })

    /* 9 — back to view mode */
    await js<boolean>(`(() => { [...document.querySelectorAll('.segmented button')].find(b => b.textContent === 'View').click(); return true })()`)
    await wait(500)
    check('returns to view mode', (await js<number>(`document.querySelectorAll('.preview-scroll').length`)) === 1)

    /* 10 — hidden authorship signature */
    const sig = await js<string>(`document.getElementById('mn-signature')?.dataset.signature || ''`)
    check('hidden signature present', sig === 'Narashiman Krishnamurthy', sig)
    const metaAuthor = await js<string>(`document.querySelector('meta[name="author"]')?.content || ''`)
    check('author metadata present', metaAuthor === 'Narashiman Krishnamurthy', metaAuthor)

    /* 11 — About dialog */
    win.webContents.send('menu:action', { action: 'help:about' })
    await wait(700)
    const aboutText = await js<string>(`document.querySelector('.about-modal')?.textContent || ''`)
    check('about shows author', aboutText.includes('Narashiman Krishnamurthy'), aboutText.slice(0, 60))
    check('about shows licence', aboutText.includes('personal use') && aboutText.includes('commercial'))
    check('about shows review request', aboutText.includes('5 star'))
    const linkedIn = await js<string>(`document.querySelector('.about-modal a')?.getAttribute('href') || ''`)
    check('about links to LinkedIn', linkedIn === 'https://www.linkedin.com/in/narashimank/', linkedIn)
    const logoOk = await js<boolean>(`(() => { const i = document.querySelector('.about-logo'); return !!i && i.complete && i.naturalWidth > 0 })()`)
    check('about logo renders', logoOk)

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '04-about.png'), img.toPNG())
    })
    await js<boolean>(`(() => { document.querySelector('.about-modal .primary').click(); return true })()`)
    await wait(300)

    /* 12 — converter dialog */
    win.webContents.send('menu:action', { action: 'convert:open' })
    await wait(900)
    check('converter dialog opens', (await js<number>(`document.querySelectorAll('.convert-modal').length`)) === 1)
    check('drop zone present', (await js<number>(`document.querySelectorAll('.dropzone').length`)) === 1)
    const formatText = await js<string>(`document.querySelector('.dz-formats')?.textContent || ''`)
    check('format list shown', formatText.includes('pdf') && formatText.includes('docx') && formatText.includes('xlsx'), formatText.slice(0, 70))

    const status = await js<string>(`document.querySelector('.convert-modal .status-strip')?.textContent || ''`)
    check('converter needs no external runtime', /no Python, no setup/.test(status), status.slice(0, 80))

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '05-converter.png'), img.toPNG())
    })

    /* 13 — close the converter and open the AI panel */
    await js<boolean>(`(() => { [...document.querySelectorAll('.convert-modal .modal-actions button')].find(b => b.textContent === 'Close').click(); return true })()`)
    await wait(400)

    win.webContents.send('menu:action', { action: 'ai:toggle' })
    await wait(900)
    check('AI panel opens', (await js<number>(`document.querySelectorAll('.ai-panel').length`)) === 1)

    const chips = await js<string>(`[...document.querySelectorAll('.doc-chip')].map(c => c.textContent).join('|')`)
    check('current document is in AI context', chips.length > 0, chips.slice(0, 60))

    const quick = await js<number>(`document.querySelectorAll('.ai-quick .chip-btn').length`)
    check('AI quick actions available', quick >= 4, String(quick))

    const grounding = await js<string>(`document.querySelector('.ai-empty')?.textContent || ''`)
    check('grounding promise shown to user', grounding.includes('only from the documents'), grounding.slice(0, 60))

    check('AI composer present', (await js<number>(`document.querySelectorAll('.ai-composer textarea').length`)) === 1)

    // Settings pane: provider + model selectors, and key handling for cloud providers.
    await js<boolean>(`(() => { [...document.querySelectorAll('.ai-panel .icon')].find(b => b.title === 'AI settings').click(); return true })()`)
    await wait(500)
    const providers = await js<number>(`document.querySelectorAll('.ai-settings select')[0]?.options.length || 0`)
    check('all four providers offered', providers === 4, String(providers))

    await js<boolean>(`(() => { const s = document.querySelectorAll('.ai-settings select')[0];
      s.value = 'anthropic'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await wait(1200)
    const keyPanel = await js<string>(`document.querySelector('.key-block')?.textContent || ''`)
    check('API key panel appears for cloud provider', keyPanel.includes('Anthropic'), keyPanel.slice(0, 50))
    check('key storage explained to user', /DPAPI|plain text/.test(keyPanel))

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '06-ai-panel.png'), img.toPNG())
    })

    // Put the provider back so the saved setting stays sensible.
    await js<boolean>(`(() => { const s = document.querySelectorAll('.ai-settings select')[0];
      s.value = 'ollama'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await wait(600)
    win.webContents.send('menu:action', { action: 'ai:toggle' })
    await wait(400)

    /* 13a — convert every supported format from a real file */
    mark('starting conversions')
    const samples = join(app.getAppPath(), 'samples')
    const conversions: Array<{ file: string; expect: RegExp[] }> = [
      { file: 'sample.docx', expect: [/# Quarterly Review|## Revenue/, /fourteen percent/, /\| Region \| Owner \| Status \|/] },
      { file: 'sample.xlsx', expect: [/\| Item \| Qty \| Price \|/, /\| Widget \| 10 \| 2\.5 \|/, /## Q2/] },
      { file: 'sample.pdf', expect: [/Annual Summary/, /Revenue rose across every region/, /Second page content/] },
      { file: 'sample.pptx', expect: [/## Slide 1/, /Project Alpha/, /Speaker notes/, /## Slide 2/] },
      { file: 'sample.odt', expect: [/Meeting Notes/, /- Draft the proposal/, /\| Task \| Owner \|/] },
      { file: 'sample.epub', expect: [/# The Test Book/, /A\. Writer/, /Chapter One/, /Chapter Two/] },
      { file: 'sample.csv', expect: [/\| Name \| Qty \| Notes \|/, /has, a comma/] },
      { file: 'sample.txt', expect: [/Revenue grew by 14 percent/] }
    ]

    for (const { file, expect } of conversions) {
      mark(`converting ${file}`)
      const path = join(samples, file).replace(/\\/g, '\\\\')
      const raw = await jsWithTimeout<string>(
        `(async () => {
        try {
          const read = await window.api.readBytes("${path}");
          if (!read.ok) return JSON.stringify({ ok:false, error:read.error });
          const r = await window.__convert.convertToMarkdown(new Uint8Array(read.bytes), "${file}", {});
          return JSON.stringify({ ok:r.ok, error:r.error, markdown:(r.markdown||"") });
        } catch (e) { return JSON.stringify({ ok:false, error:String(e && e.message || e) }); }
      })()`,
        45_000,
        JSON.stringify({ ok: false, error: 'timed out after 45s' })
      )
      const parsed = JSON.parse(raw) as { ok: boolean; error?: string; markdown?: string }

      if (!parsed.ok) {
        check(`convert ${file}`, false, parsed.error)
        continue
      }
      const md = parsed.markdown ?? ''
      const missing = expect.filter((re) => !re.test(md))
      check(
        `convert ${file}`,
        missing.length === 0,
        missing.length ? `missing ${missing.map(String).join(' ')} | got: ${md.slice(0, 120)}` : `${md.length} chars`
      )
    }

    // The indented .txt is the original annotation bug: after conversion no line
    // may start with four spaces or a tab, or highlights will not render.
    const txtPath = join(samples, 'sample.txt').replace(/\\/g, '\\\\')
    const indentCheck = await jsWithTimeout<string>(
      `(async () => {
      const read = await window.api.readBytes("${txtPath}");
      const r = await window.__convert.convertToMarkdown(new Uint8Array(read.bytes), "sample.txt", {});
      const bad = (r.markdown||"").split("\\n").filter(l => /^( {4}|\\t)\\S/.test(l));
      return JSON.stringify({ bad: bad.length, sample: bad[0] || "" });
    })()`,
      30_000,
      JSON.stringify({ bad: -1, sample: 'timed out' })
    )
    const indent = JSON.parse(indentCheck) as { bad: number; sample: string }
    check('converted .txt has no indented-code lines', indent.bad === 0, indent.sample)

    /* 14 — document-level undo reverses an annotation */
    const beforeUndo = await js<number>(`document.querySelectorAll('mark.mn-highlight').length`)
    win.webContents.send('menu:action', { action: 'edit:undo' })
    await wait(600)
    const afterUndo = await js<number>(`document.querySelectorAll('mark.mn-highlight').length`)
    check('undo reverses an annotation', afterUndo < beforeUndo, `${beforeUndo} -> ${afterUndo}`)

    win.webContents.send('menu:action', { action: 'edit:redo' })
    await wait(600)
    const afterRedo = await js<number>(`document.querySelectorAll('mark.mn-highlight').length`)
    check('redo restores it', afterRedo === beforeUndo, `${afterUndo} -> ${afterRedo}`)
  } catch (err) {
    check('unexpected error', false, String((err as Error)?.stack ?? err))
  }

  const failed = results.filter((r) => !r.ok)
  await fsp.writeFile(
    join(outDir, 'result.json'),
    JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2),
    'utf8'
  )
  app.exit(failed.length ? 1 : 0)
}


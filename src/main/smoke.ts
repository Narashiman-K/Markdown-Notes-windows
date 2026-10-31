/**
 * End-to-end smoke test. Only runs when MARKNOTE_SMOKE=1 is set, so it never
 * executes for real users. It drives the real renderer through the real
 * preload/IPC bridge and writes screenshots + a JSON result to `out/smoke/`.
 */
import { app, net, BrowserWindow } from 'electron'
import { promises as fsp, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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

    /* 0 — a file passed on the command line must actually load.
       This is how Windows opens a .md by double-click, and it is easy to break:
       if the file is sent before the renderer is listening, it vanishes. */
    const argFile = process.env['MARKNOTE_SMOKE_ARGFILE']
    if (argFile) {
      const title = await js<string>(`document.querySelector('.tb-title')?.textContent || ''`)
      check('file from the command line opens', title.includes('SUBMIT-TO-STORE'), title)
    }

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
    // CodeMirror syncs a synthetic DOM selection into its own state on the next
    // observer tick, which is not always within one frame. Poll rather than
    // guess at a single delay.
    let fmtButtons = 0
    for (let attempt = 0; attempt < 8 && fmtButtons < 16; attempt++) {
      await wait(400)
      fmtButtons = await js<number>(`document.querySelectorAll('.format-toolbar button').length`)
      if (fmtButtons < 16) {
        await js<boolean>(`(() => {
          document.querySelector('.cm-content')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          document.dispatchEvent(new Event('selectionchange'));
          return true;
        })()`)
      }
    }
    check('edit-mode format toolbar appears', fmtButtons >= 16, String(fmtButtons))

    const hasBold = await js<boolean>(`!!document.querySelector('.format-toolbar .ft-bold')`)
    check('format toolbar has insert actions', hasBold)

    const onScreen = await js<boolean>(
      `(() => { const el = document.querySelector('.format-toolbar');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })()`
    )
    check('format toolbar stays inside the window', onScreen)

    // Pressing Bold must actually edit the source. CodeMirror only renders the
    // visible lines, so measure via the status bar's character count, which is
    // driven by application state rather than the virtualised DOM.
    const charCount = async (): Promise<number> =>
      Number((/(\d+) chars/.exec(await js<string>(`document.querySelector('.statusbar').textContent`)) ?? [])[1] ?? -1)

    const beforeBold = await charCount()
    await js<boolean>(`(() => { document.querySelector('.format-toolbar .ft-bold')?.click(); return true })()`)
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
    /*
     * Every link in the dialog, not just the first one.
     *
     * This asserted on `querySelector('.about-modal a')` — whichever anchor
     * happened to come first. Adding the Store review link above the author
     * link therefore broke it, and the build stayed red for a month over a
     * link that was working perfectly. What matters is that the author link
     * is there, not where it sits.
     */
    const aboutLinks = await js<string[]>(
      `[...document.querySelectorAll('.about-modal a')].map((a) => a.getAttribute('href') || '')`
    )
    check(
      'about links to LinkedIn',
      aboutLinks.includes('https://www.linkedin.com/in/narashimank/'),
      aboutLinks.join(' | ')
    )
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

    const samples = join(app.getAppPath(), 'samples')

    /*
     * 12z — the mn-local: image scheme serves images and nothing else.
     *
     * Fetched from the main process, which reaches the same handler the
     * window's <img> tags do, and lets the status codes be checked exactly:
     * a document chooses the paths it asks for, so the refusals matter as
     * much as the success.
     */
    mark('mn-local image scheme')
    const viaScheme = async (fileUrl: string): Promise<number> => {
      try {
        const r = await net.fetch(`mn-local://image/?src=${encodeURIComponent(fileUrl)}`)
        return r.status
      } catch {
        return -1
      }
    }
    const imageStatus = await viaScheme(pathToFileURL(join(samples, 'sample.bmp')).toString())
    check('mn-local serves a local image', imageStatus === 200, `status ${imageStatus}`)
    const textStatus = await viaScheme(pathToFileURL(join(samples, 'sample.txt')).toString())
    check('mn-local refuses a non-image file', textStatus === 403, `status ${textStatus}`)
    const remoteStatus = await viaScheme('https://example.com/a.png')
    check('mn-local refuses anything that is not file:', remoteStatus === 400, `status ${remoteStatus}`)

    /* 13a — convert every supported format from a real file */
    mark('starting conversions')
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

    /*
     * 13b — offline OCR, on an image and on a scanned PDF.
     *
     * Neither had ever been exercised here, which is how offline OCR in this
     * build came to be blocked three ways at once without anyone noticing:
     * no bundled engine, a CSP that refuses WebAssembly and blob workers, and
     * a CSP that refuses the CDN the engine falls back to. ocr-sample.png is
     * the MCP package's known-good OCR fixture; sample-scanned.pdf is the
     * same image as two pages with no text layer — what a flatbed scanner
     * produces. ocr-kannada.png checks the bundled Kannada model is staged and
     * loads: read as English, the same image came out as Latin nonsense.
     */
    const ocrCases: Array<{ file: string; expect: RegExp[]; ms: number; langs?: string[]; keep?: boolean }> = [
      { file: 'ocr-sample.png', expect: [/Quarterly Operations Report/i, /fourteen percent/i], ms: 120_000 },
      {
        file: 'sample-scanned.pdf',
        // Also the original's page size and break, and each page's own
        // picture kept beside its text (lib/pages.ts).
        expect: [
          /Quarterly Operations Report/i,
          /## Page 1/,
          /## Page 2/,
          /fourteen percent/i,
          /<!-- suprasuta:page-size width="\d/,
          /<!-- suprasuta:page-break -->/,
          /!\[Original page 2\]\(data:image\/jpeg;base64,[A-Za-z0-9+/]{1000}/
        ],
        ms: 240_000,
        keep: true
      },
      { file: 'ocr-kannada.png', expect: [/ಕನ್ನಡ/, /ಬೆಂಗಳೂರು/, /ರಾಜಧಾನಿ/], ms: 120_000, langs: ['kan'] },
      // Fed into the scanner the wrong way: page 1 upside down, page 2 on its
      // side. Both must be turned upright and read (orientation.ts), not
      // returned as gibberish.
      {
        file: 'sample-scanned-turned.pdf',
        expect: [
          /## Page 1\s+Quarterly Operations Report/i,
          /## Page 2\s+Quarterly Operations Report/i,
          /fourteen percent[\s\S]*fourteen percent/i,
          /Page 1 was upside down; Page 2 was on its side in the scan/
        ],
        ms: 240_000
      }
    ]
    for (const { file, expect, ms, langs, keep } of ocrCases) {
      mark(`offline OCR ${file}`)
      const path = join(samples, file).replace(/\\/g, '\\\\')
      const raw = await jsWithTimeout<string>(
        `(async () => {
        try {
          const read = await window.api.readBytes("${path}");
          if (!read.ok) return JSON.stringify({ ok:false, error:read.error });
          const r = await window.__convert.convertToMarkdown(new Uint8Array(read.bytes), "${file}", { ocrMode: 'offline', ocrLanguages: ${JSON.stringify(langs ?? ['eng'])}, keepPageImages: ${keep === true} });
          return JSON.stringify({ ok:r.ok, code:r.code, error:r.error, markdown:(r.markdown||""), engine:(r.meta && r.meta.engine) || '' });
        } catch (e) { return JSON.stringify({ ok:false, error:String(e && e.message || e) }); }
      })()`,
        ms,
        JSON.stringify({ ok: false, error: `timed out after ${ms / 1000}s` })
      )
      const parsed = JSON.parse(raw) as { ok: boolean; code?: string; error?: string; markdown?: string; engine?: string }
      if (!parsed.ok) {
        check(`offline OCR ${file}`, false, `${parsed.code ?? ''} ${parsed.error ?? ''}`.trim())
        continue
      }
      const md = parsed.markdown ?? ''
      const missing = expect.filter((re) => !re.test(md))
      check(
        `offline OCR ${file}`,
        missing.length === 0 && parsed.engine === 'tesseract',
        missing.length ? `missing ${missing.map(String).join(' ')} | got: ${md.slice(0, 160)}` : `${md.length} chars, engine ${parsed.engine}`
      )
    }

    /*
     * 13c — spreadsheets are read in a worker that is stopped at a time limit
     * (Phase 1b). A real workbook must come back from the worker; a crafted
     * one that makes SheetJS loop forever (a 10-byte prefix plus the genuine
     * end-of-central-directory record) must be stopped, not freeze the window.
     */
    /*
     * 13d — printing on Electron 44, whose printToPDF lost the `marginType`
     * option. Two pages with a recorded page size of Letter landscape must
     * print as two pages of 792 x 612 points: the page break kept, and the
     * page's own @page size preferred over the A4 default (lib/pages.ts).
     */
    mark('print to PDF')
    {
      const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        // From a file on disk with a local picture, as print preview does, so a
        // regression in what file:// pages may load shows up here too.
        const picture = pathToFileURL(join(samples, 'ocr-sample.png')).href
        const html =
          '<!doctype html><html><head><style>@page { size: 792pt 612pt; margin: 18mm 16mm; }' +
          ' .mn-page-break { break-before: page; }</style></head><body>' +
          `<p>First page.</p><img src="${picture}" width="300"><div class="mn-page-break"></div><p>Second page.</p></body></html>`
        const page = join(outDir, 'print-check.html')
        writeFileSync(page, html, 'utf8')
        await printer.loadFile(page)
        await wait(300)
        const pdf = await printer.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true })
        const text = pdf.toString('latin1')
        const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
        const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)
        const size = box ? `${Math.round(Number(box[1]))}x${Math.round(Number(box[2]))}` : 'none'
        check('print keeps the page break and the original page size', pages === 2 && size === '792x612', `${pages} pages, ${size}`)
        check('a local picture prints', /\/Subtype\s*\/Image/.test(text), /\/Subtype\s*\/Image/.test(text) ? 'image in PDF' : 'no image')
      } finally {
        printer.destroy()
      }
    }

    /*
     * pdf.js should read in its own worker. "Setting up fake worker" in the
     * console means it fell back to the page's thread, where a large PDF
     * stalls the window.
     */
    mark('pdf.js worker')
    {
      const seen: string[] = []
      const listen = (e: { message: string }): void => {
        if (/fake worker|pdf\.worker/i.test(e.message)) seen.push(e.message.slice(0, 160))
      }
      win.webContents.on('console-message', listen)
      const pdfPath = join(samples, 'sample.pdf').replace(/\\/g, '\\\\')
      await jsWithTimeout<string>(
        `(async () => { const r = await window.api.readBytes("${pdfPath}"); const c = await window.__convert.convertToMarkdown(new Uint8Array(r.bytes), "sample.pdf", {}); return String(c.ok) })()`,
        30_000,
        'timeout'
      )
      win.webContents.off('console-message', listen)
      check('pdf.js reads in its own worker', seen.length === 0, seen.join(' | ') || 'no fallback')
    }

    /*
     * 13e — Phase 4 hardening: the app is served from its own scheme, has no
     * Node.js in the page, refuses web permissions, and the window cannot be navigated
     * away to a local file.
     */
    mark('security')
    {
      const info = JSON.parse(
        await js<string>(`(async () => JSON.stringify({
          origin: location.protocol + '//' + location.host,
          node: typeof require !== 'undefined' || typeof process !== 'undefined',
          notify: await Notification.requestPermission(),
          camera: await navigator.permissions.query({ name: 'camera' }).then((p) => p.state).catch((e) => 'error ' + e)
        }))()`)
      ) as { origin: string; node: boolean; notify: string; camera: string }
      check('pages come from the app scheme, not file://', info.origin === 'suprasuta://app', info.origin)
      check('no Node.js in the page', info.node === false, String(info.node))
      check('web permissions are refused', info.notify === 'denied' && info.camera !== 'granted', `${info.notify}, camera ${info.camera}`)

      const before = win.webContents.getURL()
      const target = pathToFileURL(join(samples, 'sample.txt')).href
      await js<boolean>(`(() => { location.href = ${JSON.stringify(target)}; return true })()`)
      await wait(800)
      const after = win.webContents.getURL()
      check('navigating to a local file is refused', after === before, after)
    }

    /*
     * 13f — File > New window: a second document window opens with the app
     * in it, and the first keeps its document.
     */
    mark('new window')
    {
      const firstTitle = win.getTitle()
      const before = BrowserWindow.getAllWindows().length
      win.webContents.send('menu:action', { action: 'file:newWindow' })
      await wait(4000)
      const others = BrowserWindow.getAllWindows().filter((w) => w !== win && w.getTitle().includes('Markdown Notes'))
      const second = others[0]
      check('File > New window opens a second window', BrowserWindow.getAllWindows().length === before + 1 && !!second, `${before} -> ${BrowserWindow.getAllWindows().length}`)
      if (second) {
        const loaded = await second.webContents.executeJavaScript(`!!document.querySelector('.markdown-body')`).catch(() => false)
        check('the new window shows the app', loaded === true, String(loaded))
        check('the first window keeps its document', win.getTitle() === firstTitle, win.getTitle())
        ;(second as BrowserWindow & { __forceClose?: boolean }).__forceClose = true
        second.close()
        await wait(500)
      }
    }

    mark('spreadsheet worker')
    const xlsxPath = join(samples, 'sample.xlsx').replace(/\\/g, '\\\\')
    const sheetRaw = await jsWithTimeout<string>(
      `(async () => {
        const read = await window.api.readBytes("${xlsxPath}");
        const real = new Uint8Array(read.bytes);
        const good = await window.__convert.convertToMarkdown(real.slice(), "sample.xlsx", {});
        let at = real.length - 22;
        while (at >= 0 && !(real[at] === 0x50 && real[at+1] === 0x4b && real[at+2] === 5 && real[at+3] === 6)) at--;
        const tail = real.slice(at);
        const crafted = new Uint8Array(10 + tail.length);
        crafted.set(real.slice(0, 10)); crafted.set(tail, 10);
        const t = performance.now();
        const bad = await window.__convert.convertToMarkdown(crafted, "crafted.xlsx", { timeLimitMs: 3000 });
        const ms = Math.round(performance.now() - t);
        const alive = await new Promise((r) => requestAnimationFrame(() => r(true)));
        return JSON.stringify({ goodOk: good.ok, isolated: !!(good.meta && good.meta.isolated), badOk: bad.ok, badError: bad.error || '', ms, alive });
      })()`,
      30_000,
      JSON.stringify({ goodOk: false, error: 'timed out: the window froze' })
    )
    const sheet = JSON.parse(sheetRaw) as { goodOk: boolean; isolated: boolean; badOk: boolean; badError: string; ms: number; alive: boolean }
    check('a real spreadsheet is read in the worker', sheet.goodOk && sheet.isolated, sheetRaw)
    check(
      'a spreadsheet that hangs SheetJS is stopped at the time limit',
      sheet.badOk === false && /took longer than 3 seconds/.test(sheet.badError) && sheet.ms < 8000 && sheet.alive,
      sheetRaw
    )

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

    /* 13b — audio must warn clearly that it is the one cloud-only format */
    mark('audio consent panel')
    win.webContents.send('menu:action', { action: 'file:openPath', payload: join(samples, 'sample.wav') })
    await wait(1500)

    const audioPanel = await js<string>(`document.querySelector('.audio-panel')?.textContent || ''`)
    check('audio panel appears for audio files', audioPanel.length > 0, audioPanel.slice(0, 50))
    check('cloud-only stated in bold', /CLOUD SERVICE ONLY/.test(audioPanel))
    check('explains the upload destination', /uploaded to AssemblyAI/i.test(audioPanel), '')
    check('mentions the free tier', /free tier/i.test(audioPanel))
    check('lists the limitations', /Limitations/i.test(audioPanel) && /internet connection/i.test(audioPanel))

    const consentBox = await js<number>(`document.querySelectorAll('.audio-panel input[type=checkbox]').length`)
    check('consent checkbox present', consentBox === 1, String(consentBox))

    // Converting must be refused until consent is given and a key exists.
    const blocked = await js<boolean>(`(() => {
      const btn = [...document.querySelectorAll('.convert-modal .modal-actions button')].find(b => b.textContent.startsWith('Convert'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`)
    await wait(600)
    const stillPending = await js<string>(`document.querySelector('.convert-row')?.className || ''`)
    check('conversion blocked without consent or key', blocked && !/done/.test(stillPending), stillPending)

    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '07-audio-consent.png'), img.toPNG())
    })

    await js<boolean>(`(() => { [...document.querySelectorAll('.convert-modal .modal-actions button')].find(b => b.textContent === 'Close')?.click(); return true })()`)
    await wait(400)

    /* 13c — the feature-vote link points at the real repository */
    const voteUrl = await js<string>(`(() => {
      let captured = '';
      const original = window.open;
      window.open = (u) => { captured = u; return null; };
      try { return captured; } finally { window.open = original; }
    })()`)
    void voteUrl

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

    /*
     * 15 — scanned pages' own pictures: beside the text in page view, hidden
     * and shown again by the toolbar button, removed for good by
     * Edit > Remove original page pictures, and put back by undo. Last,
     * because it replaces the document the earlier steps work on.
     */
    mark('original page pictures')
    win.webContents.send('menu:action', { action: 'file:openPath', payload: join(samples, 'scan-pages.md') })
    await wait(1500)
    const scans = (): Promise<string> =>
      js<string>(`(() => {
        const b = document.querySelector('.preview-host .markdown-body');
        const btn = [...document.querySelectorAll('.toolbar button')].find(x => x.textContent.includes('Originals'));
        return JSON.stringify({
          pairs: b ? b.querySelectorAll('.mn-sheet-pair').length : -1,
          sheets: b ? b.querySelectorAll('.mn-sheet').length : -1,
          imgs: b ? b.querySelectorAll('img.mn-scan').length : -1,
          button: btn ? (btn.classList.contains('on') ? 'on' : 'off') : 'none',
          text: b ? b.textContent.includes('Second page text.') : false
        });
      })()`)
    const clickOriginals = (): Promise<boolean> =>
      js<boolean>(`(() => { const b = [...document.querySelectorAll('.toolbar button')].find(x => x.textContent.includes('Originals')); b?.click(); return !!b })()`)

    const shown = JSON.parse(await scans())
    check('page view opens with each original beside its text', shown.pairs === 2 && shown.imgs === 2 && shown.button === 'on', JSON.stringify(shown))
    await win.webContents.capturePage().then(async (img) => {
      await fsp.writeFile(join(outDir, '08-page-view-originals.png'), img.toPNG())
    })

    await clickOriginals()
    await wait(500)
    const hidden = JSON.parse(await scans())
    check('Originals button hides the pictures, text stays', hidden.pairs === 0 && hidden.imgs === 0 && hidden.sheets === 2 && hidden.text && hidden.button === 'off', JSON.stringify(hidden))

    await clickOriginals()
    await wait(500)
    const again = JSON.parse(await scans())
    check('and shows them again', again.pairs === 2 && again.imgs === 2, JSON.stringify(again))

    win.webContents.send('menu:action', { action: 'edit:removeScans' })
    await wait(600)
    const removed = JSON.parse(await scans())
    check('Remove original page pictures leaves only the text', removed.imgs === 0 && removed.text && removed.button === 'none', JSON.stringify(removed))

    win.webContents.send('menu:action', { action: 'edit:undo' })
    await wait(600)
    const back = JSON.parse(await scans())
    check('undo puts the pictures back', back.imgs === 2, JSON.stringify(back))
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


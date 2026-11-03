# Architecture — Suprasūtā Markdown Notes (Windows)

The desktop build: an Electron application that opens, converts, annotates and
exports Markdown, published to the Microsoft Store.

This document is for someone who has cloned the repository and wants to find
their way around without breaking an invariant they could not have guessed at.
It explains what the pieces are, how they fit, and — where the answer is not
obvious — why they are that way.

---

## 1. At a glance

| | |
|---|---|
| Version | 1.2.0 (Microsoft Store, November 2026) |
| Shell | Electron 44, built by electron-vite 5 / Vite 7 |
| UI | React 18 + TypeScript |
| Editor | CodeMirror 6 |
| Renderer | markdown-it → DOMPurify |
| Packaging | electron-builder → NSIS installer and MSIX for the Store |
| Native modules | **none** |
| WASM | one: the Tesseract OCR engine (English, Kannada, Hindi built in) |

Three processes, the standard Electron division:

- **Main** (`src/main/`) — Node, full privilege. Owns the filesystem, the
  settings file, credentials, every window, and every network call.
- **Preload** (`src/preload/`) — the contextBridge. Exposes exactly one object,
  `window.api`, and nothing else.
- **Renderer** (`src/renderer/`) — React. No Node, no network, strict CSP.

---

## 2. Layout

```
src/
  main/
    index.ts        lifecycle, windows, protocols, ~50 IPC handlers
    menu.ts         keyboard accelerators (the visible menu bar is drawn in the page)
    store.ts        settings.json, recent files
    cloud-folders.ts  OneDrive / Google Drive / Dropbox / iCloud / Box folders
    secrets.ts      API keys, encrypted with DPAPI
    ai.ts           Ollama, Claude, OpenAI, Gemini
    transcribe.ts   audio → text
    shots.ts        Store screenshot harness   (MARKNOTE_SHOTS=1)
    smoke.ts        end-to-end UI harness      (MARKNOTE_SMOKE=1)
  preload/
    index.ts        window.api — the entire IPC contract, in one file
  renderer/
    index.html      Content-Security-Policy lives here
    src/
      App.tsx       document state and the action switch
      components/   Editor, Preview, LivePreview, MenuBar, AiPanel,
                    CompareView, MergeDialog, ReaderControls, …
      lib/          the algorithms — see §4
      lib/convert/  document converters — see §5
      styles/       app.css, markdown.css
  shared/           brand.ts, formats.ts, types.ts — main and renderer both
```

---

## 3. Process model and the IPC contract

`src/preload/index.ts` is the whole contract. Read it first; it is under a
hundred lines and it tells you everything the renderer is allowed to do.

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true
}
```

The page runs in Chromium's sandbox. The preload uses only what a sandboxed
preload may (`contextBridge`, `ipcRenderer`, `webUtils.getPathForFile` for
dropped files).

**The app loads from its own scheme, `suprasuta://app/`, not `file:`.** The
`grantFileProtocolExtraPrivileges` fuse is off, so a `file:` page would lose
fetch and workers; the app scheme is registered privileged (fetch, streaming,
code cache) because pdf.js, Tesseract and the spreadsheet worker load their
files with fetch. Pictures on disk that a document refers to come through a
second scheme, `mn-local:`, which serves image files only and is allowed only
in the CSP's `img-src`.

Every window also gets: a permission handler that refuses everything except
clipboard writes and full screen; `<webview>` is refused; `setWindowOpenHandler` and `will-navigate` guards, so a link
in a document can never navigate the app page (web links open in the browser).

### Several windows

Each window is a separate document. IPC handlers are wrapped so that
`currentWindow()` means *the window that asked* (an `AsyncLocalStorage`
around each `ipcMain.handle`), never "whichever is focused". Per-window maps
keep each window's file, file watcher and pending open. A file double-clicked
in Explorer asks where to open (setting: *Ask each time*), and never replaces
a window holding unsaved edits without asking.

Compare documents can read another window's document and send edited text
back (`compare:windows` / `compare:windowText` / `compare:setWindowText`).
The page side is `window.__mnCompare`; text crosses as a JSON literal, so
document content is never run as code.

The renderer's CSP (`src/renderer/index.html`) ends with `connect-src 'self'`.
**The renderer cannot reach the network at all.** Every AI provider call goes
out through `ai:chat` in the main process. This is not belt-and-braces; it is
the reason API keys can be kept out of page context entirely.

### Where work happens, and why it is split the way it is

Two placements look inconsistent until you see the constraint behind each:

- **Conversion runs in the renderer.** The main process only supplies bytes
  (`file:readBytes`), writes results (`file:writeText`) and performs the one
  key-holding cloud OCR call. The converters are browser-shaped because they
  are shared with the web app — running them renderer-side is what keeps them
  identical.
- **AI calls run in main.** The renderer's CSP forbids network access, and keys
  must never be reachable from page context. The renderer can ask *whether* a
  key exists and can set one; it can never read one back.

---

## 4. The algorithms

These live in `src/renderer/src/lib/` and are the parts worth understanding
before changing anything.

### An invariant that reaches across modules

`lib/markdown.ts` configures markdown-it with `typographer`, `linkify` and
smartquotes **off**. That is not a style preference. It keeps the rendered text
a character-for-character subsequence of the source, which is the property
`lib/align.ts` depends on. Turning smart quotes on would replace `"` with `"`,
the subsequence property would break, and annotations would start landing in
the wrong place with no obvious connection to the change that caused it.

### `align.ts` — rendered text back to source offsets

Annotations are applied by selecting text in the *preview*, so a DOM range has
to resolve to a range in the Markdown *source*. `buildSourceMap` walks both
strings forward with two pointers.

The rule that makes it work is subtractive: whitespace is recorded but **never
searched for, and never advances the cursor**. The renderer puts a newline
between two table cells whose source reads `| Site | Purpose |`; searching
forward for that newline jumps the cursor past `Purpose`, which can then never
be found, because the walk only moves forward. One table was enough to corrupt
every offset after it.

The second rule: **hidden stretches are stepped over** (`hiddenRanges`): a
picture's whole `![alt](address)`, a link's `(address)`, HTML tags and
comments. A picture embedded as a data URL is tens of thousands of letters;
the walk used to find the next visible letters inside it, so a highlight next
to a picture was written into the picture's data (fixed in 1.2.0, with
`repairPictures()` in `annotations.ts` mending files damaged before the fix,
on opening).

Supporting pieces: `rangeToOffsets` measures with a probe `Range` rather than a
cached index, `trimRange` shrinks past trailing whitespace (a double-click
selection includes it), `toSourceRange` maps a rendered span to source offsets.

### `syncScroll.ts` — editor and preview together

Both sides implement the same `ScrollSyncTarget` interface and `linkScrollers`
joins any two. Neither is the master — when one side is treated as authoritative,
the pane you are *not* touching starts fighting you. The preview side reads
`data-line` attributes stamped by a markdown-it core rule that only fires when
`env.sourceLines` is set, so line numbers never reach exported or printed HTML.

### `blockTints.ts` — background tints per block

Converted documents produce long stretches with no visual structure; a
spreadsheet becomes a 200-line table that looks like the prose above it. Syntax
highlighting colours the *markers*, which is no help when the markers are off
screen — exactly when you need to know whether you are still inside the block.

Ranges come from the Lezer tree the Markdown mode already maintains. A regular
expression would have to guess about fences nested in blockquotes and stray
backticks in prose, and Lezer's tree is incremental, so typing in a large
document reuses the parse instead of redoing it.

### `smartPaste.ts` — paste from Word, Excel, a browser

Reads the clipboard's HTML flavour and converts it through the same
`htmlToMarkdown` the document converters use, so pasting a table and converting
a document containing one cannot produce two dialects in the same file.

Three details that took real documents to get right: `fragment()` trims to
`<!--StartFragment-->` markers but refuses a slice that would orphan `<tr>`
elements, because Excel puts its markers *inside* the table;
`promoteHeaderRows()` drops empty rows and picks the widest row as the header,
because a merged title row otherwise makes the header one column wide; and the
chooser follows Word — the formatted version is pasted and two small buttons
appear at the insertion point offering plain text instead, so nobody has to
know a modifier key exists.

### `annotations.ts` — annotations stored in the document

Highlights, underlines and comments are HTML tags written **into the Markdown**,
not held in a sidecar file. The document stays portable: annotations survive
being emailed, opened in another editor, or committed to git. `codeRegions()`
and `segmentRange()` split a selection that spans a code fence rather than
injecting tags into code, and never let a tag start or end inside a picture
or a link address (a picture touched by a selection is wrapped whole).

### `annotationTransfer.ts` — annotations out of a file and back

Export writes each annotation with its exact words, the words around it
(prefix/suffix), its section heading and its position. Import finds each one
again on any copy of the document, even an edited one: exact match, then
spacing-insensitive, then bigram similarity, choosing between repeats by their
surroundings. It adds, skipping ones already there, or (when asked) makes the
document match the file, removing annotations the file does not have. What
cannot be placed is listed, never silently dropped. Notes from the file are
attribute-escaped; unknown types become highlights.

### `compare.ts` — Compare documents

Myers' O(ND) difference, first over lines and then over the words of each
changed block (Unicode-aware, so Kannada and Hindi words are marked as words).
Nothing is ignored except invisible CRLF line endings. The trace is stored
only for the diagonals each step can read, and capped at 2,000 edits, so a
pathological pair shows as one large change instead of exhausting memory.
`takeChange` / `replaceChangeSide` rebuild either side with one change taken
across or edited; `htmlReport` / `markdownReport` / `unifiedDiff` export it
(the unified diff is also what the AI is given to explain). `CompareView.tsx`
is the UI: side by side or inline, per-block edit, whole-text edit, save each
side through its own source.

### `retrieval.ts` — grounding for the AI panel

BM25 keyword ranking over chunks split on heading boundaries. No embeddings, no
model, no network — which is what keeps the offline promise intact. Documents
small enough to fit the token budget are sent whole; only oversized ones are
ranked.

### `history.ts` — undo above the editor

CodeMirror keeps its own history, but that only covers typing in the source
editor. Annotations applied in view mode and edits made by the AI happen outside
it, so a 120-entry document-level stack sits above the whole thing.

---

### Saving: AutoSave and recovery

AutoSave writes into the file every 30 seconds while there are changes (not
30 seconds after the last keystroke, which steady typing would never reach).
A new document is asked for a name once; if the user cancels, a recovery copy
is kept in `userData/Recovery/` instead and offered at the next start. The
app's own write also fires the file watcher; it is recognised by content and
ignored. A change made by another program while there are unsaved edits here
asks which version to keep, and AutoSave waits for the answer.

Save keeps you in Edit mode.

## 5. Converters

`src/renderer/src/lib/convert/` turns PDF, Word, Excel, PowerPoint,
OpenDocument, EPUB, CSV, HTML, images and audio into Markdown. It is pure:
bytes in, Markdown out.

This directory is **one of four copies** across the project family. See §8.

| File | Handles | Via |
|---|---|---|
| `pdf.ts` | PDF | pdfjs-dist |
| `pdfImages.ts` | pictures in text PDFs, placed where they sit; also Word, PowerPoint, EPUB pictures | pdf.js operator list, canvas |
| `pdfOcr.ts`, `orientation.ts` | scanned PDFs, upside-down and sideways pages turned upright first | tesseract.js |
| `office.ts` | docx, pptx, odt, epub | mammoth, jszip, DOMParser |
| `sheet.ts`, `sheetWorker.ts` | xlsx, xls, ods, csv — in a worker stopped at a time limit | SheetJS 0.20.3 (vendored) |
| `html.ts` | HTML → Markdown | Turndown + gfm plugin |
| `ocr.ts` | images | tesseract.js (WASM), or cloud |
| `audio.ts` | audio | cloud transcription |
| `text.ts`, `normalise.ts` | plain text, tidying | — |

EPUB: each chapter is parsed as XHTML (falling back to HTML); links inside the
book (contents, index, footnotes) become `#epub-N` anchors in the one
document, links to places not in the book become plain text, and the book's
pictures are embedded. `Preview.tsx` follows the *written* href: `#` scrolls,
web links open outside, anything else does nothing (a relative link used to
load a blank page).

---

## 6. Security

- **API keys** are encrypted with Electron's `safeStorage`, which on Windows is
  backed by DPAPI: the ciphertext only decrypts for the same Windows user on
  the same machine. Copying `settings.json` to another computer yields nothing.
  Stored with an `enc:v1:` prefix so the format can change later.
- **Keys never leave the main process.** `ai:keyState` reports presence;
  `ai:setKey` writes. There is no channel that returns a key.
- **CSP** blocks network access from the renderer entirely.
- **`file:` URLs** are admitted for images only — `lib/markdown.ts` opens
  markdown-it's `validateLink` and DOMPurify's URI allow-list for them, and a
  sanitiser hook strips `href` from `file:` anchors, because clicking one would
  hand an arbitrary local path to the shell. The image itself is served
  through `mn-local:` (images only).
- **Sandboxed page, own scheme, navigation and permission guards** — §3.
- **All seven Electron fuses are set** (`electron-builder.yml`): no
  `RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, cookie encryption on,
  ASAR integrity validation on, only-load-from-ASAR, no extra `file:`
  privileges. CI reads them back from the packaged `.exe` and fails if any
  differs.
- **Dependency audit gate.** `scripts/audit-gate.mjs` runs `npm audit` and
  fails on any high or critical advisory not listed, with a reason and a
  review date, in `audit-allowlist.json` (empty here). It runs in CI on every
  push. Remaining moderate advisories are in build-time tooling only
  (electron-builder's dependency chain), not in the shipped app.
- **Spreadsheets** are parsed in a worker that is terminated at a time limit,
  so a crafted file cannot hang the app (SheetJS 0.20.3, which fixes the
  prototype-pollution and ReDoS advisories of 0.18.x).
- **Compare and annotation import** treat file content as data: notes are
  attribute-escaped, other-window text crosses as JSON, reports escape HTML.

---

## 7. Build, test and release

```
npm run dev          electron-vite dev
npm run typecheck    tsc for main and renderer
npm test             vitest — 16 suites, ~215 tests
npm run smoke        gated end-to-end run against the real UI (118 checks)
npm run audit:gate   dependency audit, fails on unaccepted high/critical
npm run dist:win     NSIS installer
npm run dist:store   AppX packages (x64 and arm64) for the Microsoft Store
```

`dist:store` finds `makeappx.exe` in the newest installed Windows SDK; the
GitHub workflow builds the same packages on every push to `main` and keeps
them as the `windows-packages` artifact.

**All dependencies live in `devDependencies`, and that is correct.**
electron-vite bundles main, preload and renderer into `out/`, so nothing needs
to survive into the packaged app's `node_modules`. The asar ships code, not a
dependency tree.

**No native modules anywhere.** No node-gyp, no prebuilds, no `.node` binaries.
This is why `electron-builder --win appx` produces a Store-acceptable MSIX with
no native rebuild step, and it is also what allows the converters to be shared
with a browser.

Two harnesses are gated behind environment variables and never run for users:

- `MARKNOTE_SMOKE=1` → `src/main/smoke.ts` drives the real UI end to end.
- `MARKNOTE_SHOTS=1` → `src/main/shots.ts` produces the Store screenshots in
  `store-screenshots/` (fixed window size, pointer parked, annotations made on
  a temporary copy of the sample). Run with `MARKNOTE_SMOKE=1` as well, which
  exposes the converters it needs; `MARKNOTE_SHOTS_NO_AI=1` skips the AI shot.

`scripts/smoke.mjs` deletes `result.json` before spawning. Without that it can
read a previous run's file and report a pass that never happened.

---

## 8. This repository's place in the family

Four repositories share a converter core and, between the two apps, most of the
user interface:

| Repository | What it is |
|---|---|
| **Markdown-Notes-windows** (this one) | Electron desktop app, Microsoft Store |
| Markdown-Notes-web | Browser app, PWA |
| Markdown-Notes-MCP | MCP server for Claude Desktop and other hosts |
| Markdown-Notes-VSCode | VS Code / Antigravity extension |

### Shared code is copied, not depended on

The converters exist in four copies by deliberate choice. A shared npm package
would remove drift by construction — and would also tie four independent
release cadences together, so that a converter fix could not reach the web app
without a publish cycle, and the MSIX, the VSIX and the PWA cache would all have
to move at once.

The judgement was that independent release cadences are worth more than enforced
sameness, **provided drift is visible**. `Markdown-Notes-MCP` carries
`scripts/sync-converters.mjs` for that:

```
npm run sync:check     compare every copy, list differences
npm run sync:pull      pull a named project's version in
```

The MCP copy is canonical. It is the only one with the runtime hook that lets
identical files run in a browser and under Node, so improvements start there and
flow outward.

### Shared UI between this app and the web app

26 of the 42 comparable files are byte-identical, including `Editor.tsx`,
`LivePreview.tsx`, `ReaderControls.tsx`, `Toolbar.tsx`, and nearly all of
`lib/`. Those files carry a line in their header:

> *Kept identical to the copy in the Windows app. Change one, copy it across.*

Take it literally. If you change a shared file here, copy it to
`Markdown-Notes-web` in the same commit.

The files that legitimately differ are the ones that touch the platform:
`App.tsx`, `MenuBar.tsx`, `ConvertDialog.tsx`, `FindBar.tsx`, `app.css`. This
build reaches the host through `window.api`; the web build reaches it through a
`Platform` interface.

---

## 9. Conventions worth knowing

- **z-index bands.** Declared at the top of `app.css`: document furniture
  (0–59), docked panes (60–99), application chrome (100–199), window-level
  overlays (200+). A menu is the user acting on the app, so nothing inside the
  document may paint over it. Add to a band rather than picking a number.
- **`data-mn-ignore`** marks elements the annotation walker must skip.
- **Provenance.** `lib/signature.ts` stamps authorship into the live DOM, into
  exported HTML and PDF, and into the packaged image assets.
- **Never commit `Converted-Files/`.** It is gitignored; check `git status`
  before `git add -A`.
- **Never paste an access token into a chat, an issue, or a commit.**

---

## 10. Where this is going

Shipped in 1.1.0: regex find and replace, symmetric sync scrolling, format
editing in the live preview, per-block background tints, smart paste.

Shipped in 1.2.0: Compare documents; Reader mode; Merge files; multiple
windows; AutoSave with recovery; cloud-storage folders; annotation export and
import; pictures kept from PDF, Word, PowerPoint and EPUB; full EPUB with
working internal links; offline OCR in English, Kannada and Hindi with
upright-page detection; page view at the original page size; Electron 44 with
all fuses, sandbox and the audit gate.

Planned next: anonymous usage analytics (on by default, no content or personal
data), read aloud and dictation (free and offline), more OCR languages on
demand, an annotation study sheet, a table editor.

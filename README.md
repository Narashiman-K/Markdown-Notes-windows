<div align="center">

# Suprasūtā Markdown Notes

**A Markdown viewer, editor, annotator and document converter for Windows 11.**

Highlights and comments are saved *inside* the `.md` file as standard HTML, so an
annotated document stays a portable Markdown file. Converts PDF, Word, Excel,
PowerPoint, EPUB and more. Answers questions about your documents using a local
AI model or your own API key.

[![Build](https://github.com/Narashiman-K/Markdown-Notes-windows/actions/workflows/build.yml/badge.svg)](https://github.com/Narashiman-K/Markdown-Notes-windows/actions/workflows/build.yml)
[![Licence: Personal use](https://img.shields.io/badge/licence-personal%20use-blue)](LICENSE.md)
[![Platform: Windows 11](https://img.shields.io/badge/platform-Windows%2011-0078D4)](#)

Created by **[Narashiman Krishnamurthy](https://www.linkedin.com/in/narashimank/)**

*Suprasūtā* — "generating excellent, high-quality outputs abundantly."

</div>

---

> **Licence:** free for personal, non-commercial use. Commercial use requires a
> separate licence — see [LICENSE.md](LICENSE.md). The source is public so you
> can read, audit and learn from it; that is not a grant of commercial rights.

---

## Why this exists

Most Markdown editors make you choose between reading and marking up. This one
lets you highlight a passage, attach a comment, and still hand the file to
someone who has never heard of this app — because the annotation is just
`<mark data-mn-type="highlight">` in the Markdown, which every renderer
understands.

## Features

### Reading

- CommonMark plus tables, task lists, footnotes and definition lists
- Syntax highlighting for ~40 common languages
- Zoom 60–300 % (`Ctrl` `+`/`-`/`0`, or `Ctrl` + scroll)
- Outline panel, find-in-page, light/dark/system themes
- Reloads automatically when the file changes on disk

### Annotating

Select text in view mode and a toolbar appears.

| Annotation | Stored in the file as |
| --- | --- |
| Highlight (5 colours) | `<mark class="mn-a mn-highlight" data-mn-color="yellow" …>` |
| Underline | `<u class="mn-a mn-underline" …>` |
| Strikethrough | `<s class="mn-a mn-strike" …>` |
| Comment | `<span class="mn-a mn-comment" data-mn-note="…" …>` |

Code blocks are never annotated, and a selection spanning several blocks is
split into one wrapper per block so the Markdown stays valid.

### Editing

- CodeMirror 6 source editor with a floating format bar on selection
- Split view: source left, live preview right
- `Ctrl+S` saves **and returns to view mode**

### Converting to Markdown

`Ctrl+Shift+M`, or drop any file onto the window.

| Group | Formats | Runs |
| --- | --- | --- |
| Documents | `pdf` `docx` `xlsx` `xlsm` `xls` `pptx` `odt` `ods` `epub` | **Offline** |
| Text & data | `txt` `csv` `tsv` `json` `yaml` `xml` `html` `rtf` `srt` `vtt` + source code | **Offline** |
| Images (OCR) | `jpg` `png` `gif` `webp` `bmp` `tif` | Offline *or* cloud |
| Audio | `mp3` `wav` `m4a` `flac` `ogg` `aac` | **Cloud only** |

Everything except audio works with no internet connection and no account.

### Ask your documents (AI)

`Ctrl+Shift+A` opens a panel beside the document.

- **Grounded.** The assistant sees only the passages from documents you have
  loaded, and is instructed to answer from nothing else. Ask something they
  don't cover and it says so rather than inventing an answer.
- **Cited.** Every claim is tagged `[1]`, `[3]`; click to jump to the passage.
- **Multi-document.** Add more files to compare and cross-reference.
- **Actionable.** Summarise, explain a selection, suggest annotations, or
  rewrite the document — rewrites open a diff you approve or discard.

| Provider | Needs | Your text goes to |
| --- | --- | --- |
| **Ollama** (default) | Ollama running locally | Nowhere — stays on your PC |
| Claude | Anthropic API key | Anthropic |
| ChatGPT | OpenAI API key | OpenAI |
| Gemini | Google AI Studio key | Google |

Signing in with a consumer `claude.ai` / `chatgpt.com` account is deliberately
not offered — those services provide no mechanism for third-party apps to use a
personal chat subscription.

## Privacy

- Documents, annotations, settings and history stay on your computer. The app
  uploads nothing on its own.
- API keys are encrypted with **Windows DPAPI** via Electron `safeStorage`, and
  are readable only by your Windows account on that machine.
- Keys never enter the renderer process; all provider calls happen in the main
  process.
- Cloud features (image OCR, audio, cloud AI) are **off until you enable them**
  with your own key, and each says plainly where your data goes.
- No analytics, no telemetry.

## Install

Download the latest installer from
[Releases](https://github.com/Narashiman-K/Markdown-Notes-windows/releases), or
build it yourself below.

## Build from source

Requires [Node.js](https://nodejs.org) 22+.

```bash
git clone https://github.com/Narashiman-K/Markdown-Notes-windows.git
cd Markdown-Notes-windows
npm install
npm run dev          # run in development
npm test             # unit tests
npm run dist:win     # Windows installer -> release/
```

> **If `npm install` seems to install nothing:** you likely have `NODE_ENV`
> set to `production` globally, which makes npm skip devDependencies — where all
> of this project's build tooling lives. The bundled `.npmrc` (`include=dev`)
> compensates; don't delete it.

### Testing

```bash
python samples/make.py    # generate sample documents (needs python-docx, openpyxl, reportlab, python-pptx)
npm test                  # 94 unit tests
npm run smoke             # 57 end-to-end checks driving the real UI
```

The smoke run writes screenshots to `out/smoke/`.

## Architecture

```
src/
  main/         Electron main process — windows, menus, file IO, printing
    ai.ts       AI providers; all network calls and keys live here
    secrets.ts  DPAPI encryption for stored credentials
    transcribe.ts  AssemblyAI audio transcription
  preload/      contextBridge API (contextIsolation on, nodeIntegration off)
  renderer/     React 18 + TypeScript UI
    lib/
      annotations.ts  annotation encode/decode/apply/remove
      align.ts        rendered-text ↔ Markdown-source offset mapper
      convert/        all document converters (pure, no platform code)
      retrieval.ts    document chunking and BM25 ranking for AI grounding
  shared/       types, brand constants and the format registry
```

**How annotation anchoring works:** `markdown-it` runs with typographer and
smart quotes off, which keeps the rendered text a character-for-character
subsequence of the source. A two-pointer walk then maps any DOM selection in the
preview back to an exact range in the Markdown.

Everything under `renderer/src/lib/` is deliberately free of Electron APIs, so
it can be reused by a future browser version.

## Roadmap

- [ ] Generate documentation from a code project (GitHub URL or local folder) —
      **[vote for it here](https://github.com/Narashiman-K/Markdown-Notes-windows/issues/new?labels=feature-vote)**
- [ ] Microsoft Store release
- [ ] Browser version

## Acknowledgements

Built on Electron, React, CodeMirror, markdown-it, DOMPurify, pdf.js, mammoth,
SheetJS, Tesseract.js and highlight.js — each under its own licence.

---

<div align="center">

If you find this useful, a ⭐ is appreciated.

</div>

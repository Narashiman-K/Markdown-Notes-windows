# Microsoft Store listing — copy and paste

Every field Partner Center asks for, filled in and ready. Character limits are
noted so you can see the headroom if you want to edit anything.

---

## Product name

*(already reserved)*

```
Suprasuta Markdown Notes
```

> Partner Center reserved the ASCII form. The app itself displays
> **Suprasūtā Markdown Notes** — that is fine and normal.

---

## Short description

*(max 500 characters — this uses 279)*

```
Read, annotate and edit Markdown files on Windows 11. Highlight passages and add comments that save directly inside the .md file, so your notes travel with the document anywhere. Convert PDF, Word, Excel, PowerPoint and EPUB to Markdown on your own computer. Ask questions about your documents using local or cloud AI.
```

---

## Description

*(max 10,000 characters)*

```
Suprasuta Markdown Notes turns Markdown from something you write into something you can read, mark up and think with.

Most editors make you choose between reading and annotating. This one lets you highlight a passage, attach a comment, and still hand the file to someone who has never heard of this app — because every annotation is written into the Markdown itself as a standard HTML tag that GitHub, VS Code, Obsidian and every other renderer already understand.

READ AND ANNOTATE
• Highlight in five colours, underline, strike through, and attach comments
• Annotations are saved inside the .md file — no sidecar files, nothing to lose
• Comments panel listing every note, with click-to-jump
• Outline panel, find-in-page, and zoom from 60% to 300%
• Light, dark, or follow your Windows theme
• Reloads automatically when a file changes on disk

EDIT WITHOUT LEAVING
• Full source editor with Markdown syntax highlighting and line numbers
• Select any text and a formatting bar appears — bold, headings, lists, tables, links, code blocks
• Side-by-side live preview while you type
• Save and you are returned straight to reading view

CONVERT ALMOST ANYTHING TO MARKDOWN
Drop a file onto the window, or press Ctrl+Shift+M.

• Documents: PDF, Word (.docx), Excel (.xlsx, .xls), PowerPoint (.pptx), OpenDocument (.odt, .ods), EPUB
• Text and data: TXT, CSV, TSV, JSON, YAML, XML, HTML, RTF, subtitles, and source code
• Images: text extracted by OCR, either offline on your PC or via the cloud
• Audio: transcribed via a cloud service

Every document and text format is converted entirely on your own computer. No account, no subscription, no internet connection required, and nothing to install alongside it.

ASK YOUR DOCUMENTS
An AI panel that stays honest about what it knows.

• Answers come only from the documents you have loaded — ask about something they do not cover and it says so, instead of inventing an answer
• Every claim is cited, and clicking a citation jumps to the exact passage
• Load several documents to compare and cross-reference them
• Summarise, explain a selected passage, or have it suggest annotations
• Ask it to rewrite the document and review the changes in a diff before anything is applied

Choose where it runs:
• Ollama — a model running on your own computer. Nothing leaves your machine.
• Claude, ChatGPT or Gemini — using an API key you supply yourself

PRIVACY BY DEFAULT
• Your documents, annotations and settings never leave your computer
• No analytics, no telemetry, no advertising, no account required
• Cloud features are switched off until you turn them on with your own API key, and each one states plainly where your data goes
• API keys are encrypted with Windows DPAPI and are readable only by your Windows account on your machine
• Open source — every claim above can be verified in the code

Created by Narashiman Krishnamurthy.
Free for personal, non-commercial use.
```

---

## What's new in this version

*(max 1,500 characters)*

```
First release.

• Read, highlight, underline and comment on Markdown files, with annotations saved inside the document
• Full source editor with a formatting bar on selection and live preview
• Convert PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, CSV and text to Markdown entirely offline
• Image text extraction, offline or via cloud OCR
• Audio transcription via a cloud service
• AI panel that answers questions strictly from your loaded documents, with citations, running locally through Ollama or via your own API key
• Print and export to PDF or HTML
```

---

## Product category

**Primary:** `Productivity`
**Secondary:** `Developer tools`

---

## Search terms

*(up to 7, max 30 characters each)*

```
markdown
markdown editor
annotate pdf
pdf to markdown
document converter
note taking
markdown viewer
```

---

## Privacy policy URL

Once GitHub Pages is switched on (Step 2 of the submission guide):

```
https://narashiman-k.github.io/Markdown-Notes-windows/privacy
```

---

## Website and support contact

**Website:**

```
https://github.com/Narashiman-K/Markdown-Notes-windows
```

**Support contact info:**

```
https://github.com/Narashiman-K/Markdown-Notes-windows/issues
```

---

## System requirements

**Minimum:** Windows 10 version 1809 (build 17763) or later
**Recommended:** Windows 11
**Architecture:** x64 and ARM64

Optional features that need extra resources — state these under "Notes":

```
The optional local AI assistant requires Ollama to be installed separately, plus around 8 GB of RAM. Optional image OCR and audio transcription features require an API key from the relevant provider, which the user supplies. None of these are required to use the application.
```

---

## Age rating

Complete the IARC questionnaire. For a document editor, every answer is **no**.
Expected result: **3+ / Everyone**.

---

## Notes for certification

Paste this into "Notes for certification". Reviewers who cannot work out how to
exercise an app fail it, so this matters more than it looks.

```
HOW TO TEST THIS APP

No account, sign-in, licence key or internet connection is required for the core functionality.

1. The app opens with a welcome document already loaded.
2. READING AND ANNOTATING: select any text in the document. A small toolbar appears above the selection. Click a coloured circle to highlight, or the speech bubble to attach a comment. Press Ctrl+Shift+C to see the annotations panel.
3. EDITING: press Ctrl+E to switch to the source editor. Select text there and a formatting toolbar appears. Press Ctrl+S to save, which returns to reading view.
4. CONVERTING: press Ctrl+Shift+M and choose any PDF, Word, Excel or PowerPoint file, then press Convert. This runs entirely offline.
5. PRINTING: Ctrl+P opens the standard Windows print dialog.

OPTIONAL FEATURES THAT ARE EXPECTED TO SHOW AS UNAVAILABLE

The AI panel (Ctrl+Shift+A) requires either Ollama installed locally, or an API key from Anthropic, OpenAI or Google that the user supplies themselves. On a clean test machine it will correctly report "Ollama not running on this computer" or "No API key saved". This is the intended behaviour, not a fault. The feature is optional and the rest of the app is fully functional without it.

Likewise, image OCR in cloud mode and audio transcription require a user-supplied API key and will state so. Image OCR in offline mode works with no key.

PRIVACY

The app collects no data, has no analytics and no server. Cloud features are off by default and each displays what is sent and where before it is used.
```

---

## Restricted capability justification (runFullTrust)

Partner Center flags `runFullTrust` on every Electron app and asks you to justify
it before the submission can proceed. This is routine, not a fault in the
package: Electron apps are Win32 desktop applications packaged via the Desktop
Bridge, and `runFullTrust` is what allows a Win32 process to run at all.
electron-builder declares it automatically.

Vague answers get rejected. Paste this into
*"Why do you need the runFullTrust capability, and how will it be used in your
product?"*

```
Suprasuta Markdown Notes is a Win32 desktop application built with Electron and packaged for the Store using the Desktop Bridge. Electron applications run as full-trust Win32 processes, so runFullTrust is required for the application to launch at all. It is declared automatically by the packaging tool (electron-builder), not requested for any additional privilege.

Full trust is used for the following, each initiated by the user:

1. Reading and writing documents the user selects through the standard Windows file dialogs — Markdown, text, PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, CSV, images and audio. The app accesses only files the user explicitly opens or saves, plus a destination folder the user chooses for converted output.

2. Printing, and exporting to PDF or HTML, through the standard Windows print dialog.

3. Encrypting the user's optional API keys at rest with the Windows Data Protection API (DPAPI) via Electron's safeStorage, so stored credentials are readable only by that Windows user account on that machine.

4. Outbound HTTPS requests to a third-party AI provider (Anthropic, OpenAI, Google or AssemblyAI), only when the user explicitly enables an optional feature and supplies their own API key. These features are disabled by default.

5. A local HTTP connection to 127.0.0.1:11434, if the user chooses to run the optional AI assistant locally via Ollama. This never leaves the machine.

The application does not require elevation, does not install services or drivers, does not modify system settings, does not write outside its own application storage and folders the user selects, and does not run in the background after being closed. It collects no telemetry and contains no advertising.

The full source code is public and can be reviewed at:
https://github.com/Narashiman-K/Markdown-Notes-windows
```

---

## Pricing and availability

- **Price:** Free
- **Markets:** All
- **Visibility:** Public
- **Schedule:** Publish as soon as it passes certification
- **Free trial:** None (the app is free)

---

## Screenshots to capture

Partner Center needs at least one, 1366×768 or larger. Four or five tells the
story properly. Use `Win+Shift+S`, or the Snipping Tool, with the window
maximised.

| # | What to show | How to set it up |
| --- | --- | --- |
| 1 | **The main idea** — a document with highlights and comments | Open a document, highlight two or three passages, add a comment, then press Ctrl+Shift+C so the annotations panel is visible |
| 2 | **Editing** | Press Ctrl+E, select a line so the formatting toolbar appears, with the live preview beside it |
| 3 | **Converting** | Press Ctrl+Shift+M so the converter dialog is open, showing the format list |
| 4 | **AI panel** | Press Ctrl+Shift+A, ask a question, and capture it with the answer and its citations visible |
| 5 | **Outline / dark theme** | Press Ctrl+Shift+O with a longer document open |

A tip that noticeably improves how these look: take them in **dark theme**. The
app was designed in it and the screenshots have more contrast on the Store page.

# Suprasūtā Markdown Notes — everything discussed, and where it stands

As of 28 September 2026, with 1.1.0 live in the Microsoft Store.

Sources: the agreed enhancement list of 24 August 2026, the second batch added
the same day, my own suggestions from that session, and the work done since.

---

## Headline

| | Count |
| --- | --- |
| Core product features shipped | **40** |
| Version 1.1 features shipped | **5** |
| Requested enhancements shipped | **1 of 8** |
| My suggested enhancements shipped | **1 of ~18** |
| Platforms live | **3 of 5** (Windows, Web, MCP) |

The honest reading: **the product is built and shipped, the enhancement
roadmap has barely started.** Almost everything in 1.1 was either a usability
fix or something I suggested, not something from your original list. That is
not necessarily wrong — the split view was unusable before 1.1 — but if the
four AI features are what you actually want the app to become, none of them
have moved.

---

## 1. Core product — shipped (v1.0, August 2026)

All of this is live on Windows and, except where noted, on the web.

**Conversion**

- PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, CSV, TSV, plain text
- Pure TypeScript converters — no Python, no Pandoc, no external runtime
- Optical character recognition, with a choice of offline engine or cloud
- Self-hosted Tesseract engine and language data, so "offline" is true
- Audio transcription via AssemblyAI, gated behind explicit consent
- De-indent normaliser, ported from the original Python

**Editing and annotating**

- Markdown viewer, editor and annotator
- Annotations written into the `.md` as standard HTML, so files stay portable
- Highlight, underline, strikethrough, bold, comments
- Undo and redo across annotations
- Find and replace with full regular expressions (CodeMirror)

**AI**

- AI panel with four providers: Ollama, Anthropic, OpenAI, Gemini
- Strict grounding — answers only from loaded documents
- Diff-before-apply for AI edits
- API keys encrypted at rest (DPAPI on Windows, Web Crypto in the browser)

**Platform and distribution**

- Microsoft Store package (MSIX/AppX), x64 and arm64
- Web app with a platform abstraction layer
- Progressive web app, installable, works offline
- Serverless proxies for OpenAI and audio
- Touch and small-screen layouts
- Privacy policy written and hosted
- Continuous integration with unit tests and a 65-check end-to-end suite

---

## 2. Version 1.1 — shipped 28 September 2026

| Feature | Origin |
| --- | --- |
| Side-by-side scroll syncing | Your request |
| Format from the rendered pane | Your request |
| Block tints for code and quotes | Your request |
| Paste keeping its formatting | **My suggestion**, and one of your four paste sources |
| New logo, per-theme artwork | Your assets |

Plus fixes: find and replace from the Edit menu, the editor jumping to the top
after formatting, and selections in tables or code applying to the wrong part
of the document — the last of which also affected annotations.

**Find and replace with regex already existed** on every platform. You asked
for it; it turned out to be there. No work needed.

---

## 3. The four enhancements you asked for — 0 of 4 shipped

Agreed 24 August 2026, roughly two features per release, one release a quarter.

| # | Feature | Status | Note |
| --- | --- | --- | --- |
| 1 | Merge several files into one | **Not started** | Deterministic, no AI. The quick one. |
| 2 | Convert many, merge, AI dedupes and tightens | **Not started** | |
| 3 | URL or repo → generated documentation | **Not started** | Largest. Windows-first, since a browser cannot fetch arbitrary URLs. |
| 4 | Distil a document into key points | **Not started** | Your example: a book, chapter by chapter. |

The plan was 1.1 = #1 and #4. **1.1 shipped neither.** What shipped instead
was the split-view work, which was not on this list at all.

**#2 and #4 are the same machine** — chunk, map the model over the chunks,
reduce into a structured document. Build it once and both become templates.
That is still the right way in.

---

## 4. The second batch — 0 of 4 shipped

Added the same day.

| Feature | Status | Note |
| --- | --- | --- |
| A4 page numbers and total count | **Not started** | Bigger than it looks; HTML has no pages until print |
| Reader mode | **Not started** | Nearly free — mostly one CSS class |
| Mind map from the document | **Not started** | Generate Mermaid from the heading hierarchy, no AI |
| Three explicit layout modes | **Partly obsolete** | 1.1's side-by-side work covered the middle mode |

**Reader mode is the cheapest thing on this entire page** and has the highest
ratio of perceived quality to effort. It should probably have been in 1.1.

---

## 5. My suggestions — 1 shipped

| Suggestion | Status |
| --- | --- |
| Paste HTML as Markdown | ✅ **Shipped in 1.1** |
| Annotation study sheet — every highlight in order, as a new `.md` | Not started |
| Table editor | Not started |
| Read aloud, word count, focus mode, templates, paste a screenshot | Not started |
| Compare two documents, local snapshots, search annotations across files | Not started |
| Flashcard / Anki export | Not started |
| Presentation mode, export to DOCX with a template, encrypted vault | Not started |

My three picks for the year were **annotation study sheet, table editor, and
paste-as-Markdown**. One of three is done.

The study sheet remains the one I would argue for hardest: the data is already
in the file, it needs no AI, and it is the most requested feature of every
annotation tool. It also gives enhancement #4 a deterministic sibling — "my
highlights" beside "the AI's summary".

---

## 6. Platforms

| Platform | Status |
| --- | --- |
| Windows (Microsoft Store) | ✅ **Live, 1.1.0** |
| Web (Vercel) | ✅ **Live**, deploys on push |
| MCP server (npm + registry) | ✅ **Published**, 0.1.4 |
| VS Code / Antigravity extension | ⏸ **Built, tested, unpublished** — awaiting your Azure DevOps token and the Eclipse agreement |
| Android | ❌ **Dropped** 24 Aug. Google Play needs 12 testers for 14 continuous days; unworkable solo. Web app installs from Chrome instead. |

---

## 7. Open items

**Blocking nothing, but outstanding**

- VS Code Marketplace publish — needs your PAT
- Open VSX publish — needs the Eclipse Publisher Agreement, which takes days
- Marketing: nothing done. LinkedIn post drafted and unreviewed since 26 Sept

**Small, known, logged**

| | |
| --- | --- |
| Converter drift between the MCP copy and the apps | `ocr.ts`, `office.ts`, `types.ts` differ; apps may be missing fixes |
| Markdown → Markdown paste normalisation | The fourth paste source you picked; needs document conventions detected first |
| Table column alignment through conversion | Map Word/Excel alignment onto `:---`; likely a converter change |
| Animated logo loaders | Assets supplied, deliberately deferred |
| Image and audio in the extension | Needs an opt-in engine download; planned for extension 1.1 |
| `softprops/action-gh-release@v2` targets Node 20 | Deprecated; still runs, will break eventually |

**Decided but never actioned**

- "Give it 5 stars" wording in both About dialogs. I recommended "leave a
  review" — Microsoft prohibits manipulating reviews, and asking for a
  specific rating reads badly to a technical audience. Still undecided.
- Review prompt at a sensible moment — after a conversion or an annotated
  save, not on launch. Not built.
- First Store screenshot should show a document covered in annotations, not an
  empty editor. Not done.
- `suprasuta.in` is registered and attached to nothing.

---

## What I would do next

1. **Reader mode** — a day at most, and it makes the app feel more finished
   than anything else on this list
2. **Annotation study sheet** — deterministic, offline, uses data you already
   store, and it is the feature this category is judged on
3. **Merge files (#1)** — your list, genuinely quick, and it unblocks #2
4. **Then the chunk-map-reduce pipeline**, which gives you #2 and #4 together

And separately from all of it: **market what already exists.** Three platforms
are live and nobody has been told.

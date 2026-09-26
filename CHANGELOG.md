# Changelog

## 1.1.0

Editing in the split view, and a new logo.

### What's new

- **Side-by-side scrolling.** The editor and the live preview now follow each
  other, in both directions. Positions are interpolated rather than snapped to
  the nearest block, so a long table or code block scrolls smoothly instead of
  the other pane jumping a screen at a time.
- **Format from the preview.** Select text in the rendered pane and a small bar
  offers Bold, Italic, Heading, inline code and Link. Only the matching source
  range is rewritten. This is the point of it: a converted document holds an
  entire paragraph on one source line, so the words you want are obvious in the
  rendered view and buried in the source.
- **Paste keeps its formatting.** Copying from Word, Outlook, a browser or a
  spreadsheet now produces proper Markdown — headings, emphasis, links and real
  tables — instead of a wall of tab-separated text. A small chooser offers plain
  text instead, the way Word does. Conversion goes through the same code as the
  document converters, so a pasted table and a converted one match.
- **Block tints.** Code fences and blockquotes get a faint background so you can
  see where each one starts and ends while scrolling. Tables and headings are
  available too; colours follow your theme and can be changed like any other
  editor colour.
- **New logo** throughout, with separate artwork for light and dark themes
  rather than one image with a filter over it.

### Fixed

- Find and replace from the Edit menu did nothing in edit mode. The keyboard
  shortcut always worked, which is why the menu item looked broken and the
  shortcut did not.
- Applying a format from the toolbar scrolled the editor back to the top and
  collapsed undo history, because the whole document was being replaced rather
  than the few characters that actually changed.
- Selections spanning table cells or highlighted code mapped to the wrong part
  of the source, so formatting could be applied somewhere else entirely. This
  also affected annotations in reading view.

## 1.0.0

First release on the Microsoft Store. Markdown viewer, editor and annotator,
with document conversion for PDF, Word, Excel, PowerPoint, OpenDocument, EPUB,
images and audio. Everything runs on your machine.

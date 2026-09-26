# Shipping 1.1.0 to the Microsoft Store

This is an **update** to a listing that is already live, which is a much
shorter path than the first submission. Name reservation, age rating,
properties and pricing all carry over. You are changing two things: the
packages and the "What's new" text.

The full first-time guide is still in [SUBMIT-TO-STORE.md](SUBMIT-TO-STORE.md)
if you need the detail behind any step.

---

## Step 1 — Get the packages built

Already started. Tag `v1.1.0` is pushed, and GitHub Actions builds the
`.appx` files on a Windows runner because that is where `makeappx.exe` lives.

**The run failed, and re-running will not help.** The Build workflow has
failed on *every* run since 24 August 2026, long before this release. The last
green build was `48fd88e1` on 20 August. Nobody noticed because no release was
cut in between, and the separate `pages-build-deployment` workflow kept showing
green in the same list.

One assertion in the end-to-end smoke test fails on the runner and passes
locally: 64 passed and 1 failed in CI, against 65 passed and 0 failed here.
The `package` job never starts at all, because it depends on `test` — which is
why no `.appx` files exist.

This has to be fixed before any Store package can be produced.

When it goes green, the run attaches the packages to a release at
**<https://github.com/Narashiman-K/Markdown-Notes-windows/releases>**.

Download both:

- `Suprasuta-Markdown-Notes-1.1.0-x64.appx`
- `Suprasuta-Markdown-Notes-1.1.0-arm64.appx`

Upload **both**. x64 covers most Windows machines; arm64 covers Surface
devices like yours and runs natively rather than emulated.

---

## Step 2 — Open a new submission

Go to **<https://partner.microsoft.com/dashboard>** → your app → **Start
update** (or **Create new submission**).

You will see the previous submission's values already filled in. Leave
everything alone except the two sections below.

---

## Step 3 — Packages

1. Open the **Packages** page
2. **Remove** the 1.0.x packages listed there
3. Drag in both `.appx` files from Step 1
4. Wait for validation to finish — it takes a minute and reports errors inline

If it complains the version is not higher than the published one, tell me the
version it says is live and I will bump past it. 1.1.0 was chosen to clear
1.0.x comfortably, but I could not read your live version from here.

---

## Step 4 — Store listing → What's new

Open **Store listing** and find **What's new in this version**. Paste:

```
Editing in the split view.

• Side-by-side scrolling — the editor and preview now follow each other,
  in both directions.

• Format from the preview — select text in the rendered pane and apply
  bold, italic, a heading, code or a link. Only that part of the source
  changes.

• Paste keeps its formatting — copy from Word, Outlook, a browser or a
  spreadsheet and get proper Markdown, including real tables, instead of
  a wall of tab-separated text. A small chooser offers plain text instead.

• Block tints — code blocks and quotes get a faint background so you can
  see where each one starts and ends.

• A new logo, drawn separately for light and dark themes.

Fixes: find and replace from the Edit menu, the editor jumping to the top
after formatting, and selections in tables or code applying to the wrong
part of the document.
```

Leave the description, screenshots and everything else as they are unless you
want to refresh them.

---

## Step 5 — Submit

**Submit to the Store**. Certification usually takes a few hours to a day.
You get an email either way.

If it is rejected, the reason is specific and fixable. Fix it, **raise the
version number** — the Store refuses a version it has already seen, even a
rejected one — rebuild, and resubmit. No penalty for resubmitting.

---

## What is not part of this

**The web app is already live.** Vercel deployed it on push, confirmed: the
new icons return 200 and the deleted `favicon.svg` returns 404 on
<https://markdown-notes-psi.vercel.app>. Nothing to do.

**The VS Code extension is still unpublished**, at your request. When you want
it, [PUBLISHING.md](../Markdown-Notes-VSCode-AG-Extension/PUBLISHING.md) in
that repo has the steps. The Eclipse Publisher Agreement for Open VSX takes a
day or two to process, so it is worth starting before you need it.

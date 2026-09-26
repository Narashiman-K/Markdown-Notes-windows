# Shipping 1.1.0 to the Microsoft Store

An **update** to a listing that is already live. Much shorter than the first
submission: name reservation, age rating, pricing, properties and screenshots
all carry over. You are changing two things — the **packages** and the
**What's new** text — and checking a third, the **privacy policy**.

Budget about fifteen minutes of clicking, then a few hours to a day of waiting.

The first-time guide with all the background is
[SUBMIT-TO-STORE.md](SUBMIT-TO-STORE.md); this is the short path.

---

## Step 1 — Download the two packages

The build is done. Go to:

**<https://github.com/Narashiman-K/Markdown-Notes-windows/releases/tag/v1.1.0>**

Download **exactly these two**:

| File | Size |
| --- | --- |
| `Suprasuta-Markdown-Notes-1.1.0-x64.appx` | 104 MB |
| `Suprasuta-Markdown-Notes-1.1.0-arm64.appx` | 110 MB |

**Ignore the three `.exe` files.** Those are standalone installers for people
who download from GitHub directly. Uploading one to the Store will fail
validation.

> **Why both `.appx` files?** x64 covers the overwhelming majority of Windows
> PCs. arm64 covers Surface devices like yours, where the x64 build would run
> under emulation — slower, and worse battery. Uploading both means every
> machine gets the right one automatically.

They are **not signed**, and that is deliberate. Microsoft re-signs Store
submissions during certification, and a self-signed package is rejected.

---

## Step 2 — Open the update

1. Go to **<https://partner.microsoft.com/dashboard>**
2. **Apps and games** → **Suprasuta Markdown Notes**
3. Click **Start update** (it may read **Create new submission**)

You now get the section list, each with a status. Every field is pre-filled
from the live submission. **Nothing is final until you press Submit at the
end** — you can leave and come back, and drafts save.

---

## Step 3 — Packages

The one section that genuinely has to change.

1. Open **Packages**
2. **Remove the existing 1.0.x packages.** There is an X or a bin icon beside
   each. If you leave them, the Store keeps shipping the old build to some
   users — it serves the highest version per architecture, so an old arm64
   package left in place keeps going to Surface owners
3. Drag both `.appx` files in, or click to browse
4. Wait for validation — a minute or two per package

**Expected result:** both listed, one showing x64 and one arm64, no errors.

Then check, below the package list:

- **Windows 10/11 device families** — **Desktop** ticked, the rest unticked
- **Package availability** — leave as is

Click **Save**.

### If validation complains

| Message | What it means |
| --- | --- |
| *Version already exists* / *must be higher* | The live version is ≥ 1.1.0. Tell me the number it reports and I will bump past it and rebuild — about ten minutes. |
| *Package identity does not match* | The identity in the build config drifted from your account. Send me the exact text; it is a one-line fix plus a rebuild. |
| *Package is not signed* | You uploaded a `.exe`, or the wrong file. Use the two `.appx` files only. |

---

## Step 4 — Store listing → What's new

Open **Store listing**. Leave the description, screenshots and everything else
alone. Find **What's new in this version** and paste:

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

Click **Save**.

---

## Step 5 — Check the privacy policy still resolves

Certification fails on a dead privacy policy URL, and it is the easiest thing
to have quietly rotted since the last submission.

Open **Properties** and confirm the privacy policy URL loads in a browser:

`https://narashiman-k.github.io/Markdown-Notes-windows/privacy`

While you are there, these should already be correct from last time:

| Field | Value |
| --- | --- |
| Category | Productivity |
| Website | `https://github.com/Narashiman-K/Markdown-Notes-windows` |
| Support contact | `https://github.com/Narashiman-K/Markdown-Notes-windows/issues` |
| Minimum system | Windows 10 version 1809 |

---

## Step 6 — Submission options, then submit

**Submission options** — leave **Publishing hold options** as *Publish as soon
as it passes certification*, unless you want to time the release yourself.

Then **Submit to the Store**.

---

## What happens next

1. **Pre-processing** — minutes
2. **Certification** — a few hours, sometimes up to a day
3. **Publishing** — an hour or two
4. Live, and existing users update automatically

You get email at each stage. The dashboard shows the same.

### If it is rejected

The rejection names a specific policy and is usually mundane. Fix it, then:

1. **Raise the version number.** The Store refuses a version it has already
   seen, including one it rejected
2. Tell me the new number; I bump, tag, and CI rebuilds
3. Upload and submit again

No penalty for resubmitting.

---

## Not part of this release

**The web app is already live.** Vercel deploys on push. Verified: the new
icons return 200 and the deleted `favicon.svg` returns 404 on
<https://markdown-notes-psi.vercel.app>.

**The VS Code extension is built but unpublished**, at your request. When you
want it, the steps are in `PUBLISHING.md` in that repo. Start the **Eclipse
Publisher Agreement** early — it takes a day or two to process and blocks the
Open VSX half, which is what Antigravity and Cursor install from.

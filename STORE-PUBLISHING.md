# Publishing Suprasūtā Markdown Notes to the Microsoft Store

Do these in order. Steps 0–2 are one-time setup; 3–8 repeat for every release.

---

## Step 0 — Fix the build environment (required, one time)

`electron-builder` extracts its Windows code-signing toolchain from a `.7z`
archive that contains macOS symlinks. Creating symlinks on Windows needs
elevated rights **unless Developer Mode is on**, so without it every packaging
run fails with:

```
ERROR: Cannot set file attribute ... winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
```

**Fix:** Settings → System → For developers → turn **Developer Mode** on, then
reboot. After that `npm run dist` and `npm run dist:store` work normally.

> Temporary workaround if you cannot enable it: `npm run dist:nosign`. This
> skips `rcedit`, so the produced `.exe` keeps Electron's default icon and
> version metadata — fine for local testing, **not** acceptable for the Store.

Also note this machine has `NODE_ENV=production` set globally. The project's
`.npmrc` (`include=dev`) compensates; don't remove it. First install also needs:

```powershell
npm install
npm install-scripts approve electron
npm install-scripts approve esbuild
npm rebuild electron esbuild
```

---

## Step 0b — Decide what to do about the converter (read before submitting)

The Convert-to-Markdown feature shells out to **Python 3 on the user's
machine**. That is fine for personal use, but it is a problem for the Store:

- A Store reviewer testing on a clean Windows image will not have Python. They
  will open the converter, see "Python 3 was not found", and may fail the
  submission for a non-functional advertised feature.
- MSIX apps run in a restricted container; spawning an arbitrary external
  interpreter is not something the packaging model expects.

Three ways forward, in order of least work:

1. **Ship it, but describe it honestly.** Do not mention conversion in the
   Store listing's headline features. Add to the certification notes:
   *"The optional Convert-to-Markdown feature requires Python 3 to be installed
   separately; the app degrades gracefully with an explanatory message if it is
   absent."* Lowest effort, some rejection risk.
2. **Hide the feature in Store builds.** Gate the menu item behind a build flag
   so the MSIX has no converter at all, and keep it in the NSIS build you
   distribute yourself. Zero rejection risk.
3. **Reimplement the converter in JavaScript** so it is bundled and offline
   (`pdfjs-dist`, `mammoth`, `xlsx`). Most work, but it removes the dependency
   entirely and covers the same document formats. Image OCR and audio would
   still need the user's own API key.

Whichever you pick, note that the image and audio paths call external APIs, so
your privacy policy (Step 5) must say that files are sent to Google Gemini /
AssemblyAI when the user supplies a key and chooses those formats.

---

## Step 0c — AI feature: what the privacy policy must say

The Store requires a privacy policy URL, and the AI panel changes what it has to
cover. Your policy must state, at minimum:

- The application stores documents, settings and annotations **locally only**.
- The AI assistant is **off by default** and does nothing until the user either
  runs a local Ollama model or supplies their own third-party API key.
- If the user supplies an API key, the passages they ask about are transmitted
  to **that provider only** (Anthropic, OpenAI or Google), under that provider's
  own privacy policy, and the publisher neither receives nor stores that content.
- API keys are stored encrypted on the user's device and are never transmitted
  to the publisher.
- The optional image OCR and audio transcription features behave the same way
  (Google Gemini and AssemblyAI respectively).
- No analytics, telemetry or advertising identifiers are collected.

Because the default configuration transfers no personal data to anyone, the
GDPR position is straightforward: cloud use is user-initiated, informed and
optional. Keep it that way — do not add a bundled default API key, as that would
make you the controller for every user's document content.

Mention in the certification notes that the AI panel needs either Ollama or a
user-supplied key, so a reviewer who sees "no API key saved" understands it is
expected rather than broken.

---

## Step 1 — Open a Partner Center developer account

1. Go to <https://partner.microsoft.com/dashboard> and sign in with the
   Microsoft account you want to own the app (use a dedicated account, not a
   work account you might lose access to).
2. Choose **Individual** (your own name is shown as the publisher) or
   **Company** (a verified business name is shown; requires business
   verification and can take days to weeks).
3. As of 2026 registration is **free** for both individual and company
   accounts — Microsoft removed the old one-off fees.
4. Complete the identity verification prompts and accept the App Developer
   Agreement.

If you want the Store listing to read something other than your legal name,
you must register as a Company.

---

## Step 2 — Reserve the app name

1. Partner Center → **Apps and games** → **New product** → **MSIX or PWA app**.
2. Type `Suprasūtā Markdown Notes` (or your chosen name) → **Check availability** → **Reserve**.
   The name is held for 3 months even if you never publish.
3. Open the new product → **Product management** → **Product identity**.
   Copy these three values exactly:

   | Partner Center field | Goes into `electron-builder.yml` |
   | --- | --- |
   | Package/Identity/Name | `appx.identityName` |
   | Package/Identity/Publisher | `appx.publisher` (the full `CN=…` string) |
   | Package/Identity/PublisherDisplayName | `appx.publisherDisplayName` |

4. Edit `electron-builder.yml` and replace the placeholder values under `appx:`.
   The build **will be rejected at upload** if these do not match character for
   character.

---

## Step 3 — Prepare the store assets

Already generated in this repo:

- `build/icon.ico` — multi-resolution app icon (16 → 256 px)
- `build/appx/` — `StoreLogo.png`, `Square44x44Logo.png`, `Square71x71Logo.png`,
  `Square150x150Logo.png`, `Square310x310Logo.png`, `Wide310x150Logo.png`,
  `SplashScreen.png`

Still needed for the **listing** (not the package):

- At least one screenshot, 1366×768 or larger, PNG. Take them with the app
  maximised; the `out/smoke/*.png` captures are a reasonable starting point.
- A short description (up to 500 characters) and a full description.
- Optional but recommended: a 2400×1200 hero image for featured placement.

---

## Step 4 — Build the MSIX package

```powershell
npm ci
npm test              # 22 unit tests
npm run build         # typecheck + bundle
npm run smoke         # end-to-end check on the real UI
npm run dist:store    # -> release\Suprasūtā Markdown Notes-1.0.0-<arch>.appx
```

Notes:

- **Do not sign the package yourself.** Microsoft re-signs Store submissions
  during certification, and a self-signed package will be rejected.
- Build both architectures. This machine is ARM64, so `npm run dist:store`
  produces the ARM64 package; to also produce x64 run
  `npx electron-builder --win appx --x64`. Upload both — Windows on ARM can run
  x64, but a native ARM64 package is noticeably faster.
- Bump `version` in `package.json` for every submission. The Store rejects a
  re-upload of a version number it has already seen.

### Local sanity check before submitting

Sideload the package to confirm it installs and launches:

```powershell
# requires Developer Mode (Step 0)
Add-AppxPackage -Path .\release\Suprasūtā Markdown Notes-1.0.0-arm64.appx -AllowUnsigned
```

Verify: app launches, `.md` file association works from File Explorer,
Open/Save dialogs work, Print opens the Windows print dialog.

---

## Step 5 — Complete the submission in Partner Center

Open your reserved product and fill in each section:

**Pricing and availability**
- Base price: Free (or set a price / trial)
- Markets: all, or restrict as you like
- Visibility: Public
- Schedule: publish as soon as it passes certification

**Properties**
- Category: `Developer tools` → `Development kits`, or `Productivity`
- Privacy policy URL — **mandatory**. Suprasūtā Markdown Notes collects no data, but you still
  need a reachable URL stating that. A GitHub Pages page is sufficient.
- Website and support contact URL/email
- System requirements: Windows 10 version 1809 (build 17763) or later

**Age ratings**
- Complete the IARC questionnaire. For a text editor every answer is "no";
  you will get a 3+ / Everyone rating.

**Packages**
- Upload the `.appx` files (drag and drop). Partner Center validates identity,
  architecture and manifest here — identity mismatches surface immediately.

**Store listing** (per language)
- Product name, short description (≤500 chars), full description
- Screenshots (at least one), app features, search terms
- Copyright and additional licence terms if any

**Submission options**
- Notes for certification: explain how to exercise the app, e.g.
  *"Open any .md file, select text in view mode to add a highlight or comment,
  press Ctrl+E to edit the source, Ctrl+S to save. No account or network access
  required."* Testers who cannot work out how to use the app will fail it.

Then **Submit to the Store**.

---

## Step 6 — Certification

- Automated checks run first (minutes), then security and content review.
- Typical turnaround: a few hours to 3 business days.
- Common rejection causes for Electron apps:
  - Package identity does not match Partner Center → recheck Step 2.
  - Missing or unreachable privacy policy URL.
  - Crash on launch on a clean machine — usually a missing runtime dependency;
    test the sideloaded package on a machine that has never run `npm`.
  - Description promises features that are not present.
- If rejected you get a report with the failing test; fix, bump the version,
  rebuild and resubmit. There is no penalty for resubmitting.

---

## Step 7 — After it goes live

- Store listing URL: `https://apps.microsoft.com/detail/<your-product-id>`
- **Updates:** bump `version`, rebuild, upload a new package, submit. Existing
  users update automatically through the Store.
- **Analytics:** Partner Center → Analytics for installs, ratings, health and
  crash reports (crash dumps arrive here automatically for Store apps).
- **Reviews:** you can respond to reviews from Partner Center.

---

## Step 8 — Optional: also ship outside the Store

`npm run dist` produces an NSIS installer in `release\`. To avoid SmartScreen
warnings on that channel you need your own code-signing certificate:

- An **OV** certificate (~$200–400/yr) still triggers SmartScreen until it
  builds reputation.
- An **EV** certificate (~$300–500/yr, hardware token or cloud HSM) gets
  immediate SmartScreen trust.
- Configure via the `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables;
  electron-builder picks them up automatically.

None of this is required for the Store — Microsoft signs Store packages for you.

---

## Quick reference

| What | Where |
| --- | --- |
| Partner Center dashboard | <https://partner.microsoft.com/dashboard> |
| Developer account FAQ | <https://learn.microsoft.com/en-us/windows/apps/publish/faq/open-developer-account> |
| Open a developer account | <https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account> |
| Packaging Electron for Windows | <https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/electron-packaging> |
| electron-builder AppX options | <https://www.electron.build/appx> |

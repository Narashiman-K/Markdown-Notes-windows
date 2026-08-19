# Submitting to the Microsoft Store — step by step

Written for someone who is not a developer. Every step says what you are doing
and why it matters.

**Roughly 45–60 minutes**, then a few days waiting for Microsoft's review.

---

## Before you start

| You need | Where it is |
| --- | --- |
| The `.msix` package | GitHub → Actions → latest run → Artifacts |
| Screenshots | You take these — see Step 3 |
| Privacy policy URL | Created in Step 2 |
| Listing text | `STORE-LISTING.md` — copy and paste |

---

## Step 1 — Download your Store package

1. Go to <https://github.com/Narashiman-K/Markdown-Notes-windows/actions>
2. Click the most recent run (the one with a green tick)
3. Scroll to the bottom, to **Artifacts**
4. Download **windows-packages**

It arrives as a `.zip`. Right-click → **Extract All**. Inside you will find:

- `Suprasuta-Markdown-Notes-1.0.0-x64.appx` ← **this is what you upload**
- `Suprasuta-Markdown-Notes-1.0.0-arm64.appx` ← **upload this too**
- Two `.exe` installers — these are for people downloading directly from GitHub,
  *not* for the Store

> **Why two `.appx` files?** One for ordinary Intel/AMD computers, one for ARM
> laptops like yours. Uploading both means every Windows user gets the version
> that runs fastest on their machine.

> **Why aren't they signed?** Microsoft signs Store packages themselves during
> certification. A package you signed yourself would be *rejected*. This is
> correct.

---

## Step 2 — Publish your privacy policy

The Store will not accept a submission without a working privacy policy URL. I
have written the policy; it needs to be live on the internet.

1. Go to <https://github.com/Narashiman-K/Markdown-Notes-windows/settings/pages>
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**
3. Set **Branch** to `main` and the folder to **`/docs`**
4. Click **Save**

Wait 2–3 minutes, then check that this loads:

**<https://narashiman-k.github.io/Markdown-Notes-windows/privacy>**

If you get a 404, wait another two minutes and refresh — the first publish is
slow.

> **What just happened?** GitHub turned the `docs` folder in your repository into
> a small website, free and permanently. The privacy policy is now a real page
> with a real address, which is what the Store requires.

---

## Step 3 — Take your screenshots

The app is open on your computer. You need **at least one**, ideally four or
five, at **1366×768 or larger**.

Maximise the window first. Use `Win+Shift+S` to capture, then paste into Paint
and save as PNG.

`STORE-LISTING.md` has a table telling you exactly what to set up for each shot.
The most important one is the first: **a document with visible highlights and
comments, with the annotations panel open**. That single image explains what
makes this app different.

---

## Step 4 — Open your submission

1. Go to <https://partner.microsoft.com/dashboard>
2. **Apps and games** → click **Suprasuta Markdown Notes**
3. Click **Start your submission** (or **Update**)

You will see a list of sections, each with a status. Work down them. Nothing is
final until you press Submit at the very end, so you can leave and come back.

---

## Step 5 — Pricing and availability

| Field | Set it to |
| --- | --- |
| Base price | **Free** |
| Free trial | No free trial |
| Markets | **All markets** (the default) |
| Visibility | **Public** — available and discoverable |
| Schedule | **Publish as soon as it passes certification** |

Click **Save**.

---

## Step 6 — Properties

| Field | Value |
| --- | --- |
| Category | **Productivity** |
| Subcategory | Leave blank, or *Personal finance*→no — pick nothing |
| Privacy policy URL | `https://narashiman-k.github.io/Markdown-Notes-windows/privacy` |
| Website | `https://github.com/Narashiman-K/Markdown-Notes-windows` |
| Support contact info | `https://github.com/Narashiman-K/Markdown-Notes-windows/issues` |

**Product declarations** — leave the defaults. This app does not access personal
information, is not a government app, and does not require special hardware.

**System requirements** — set minimum to **Windows 10 version 1809**.

Click **Save**.

---

## Step 7 — Age ratings

Click **Age ratings** and answer the IARC questionnaire.

For a document editor, **every answer is "No"**. There is no violence, no
gambling, no user-to-user communication, no sharing of location or personal
information.

The one that catches people out: *"Does the app allow users to interact or
exchange content?"* → **No.** Your app has no chat, no sharing, no user accounts.

You will get a **3+ / Everyone** rating. Click **Save**.

---

## Step 8 — Packages

This is the important one.

1. Drag both `.appx` files into the upload area (or click to browse)
2. Wait for them to validate — a minute or two

**If validation passes**, you will see them listed with their architectures.

**If you get an identity error**, it means the package identity does not match
your account. Send me the exact message; it is a one-line fix in the build
configuration and a rebuild.

Below the packages, set:

- **Windows 10/11 device families:** tick **Desktop**, untick the others
- **Package availability:** leave the defaults

Click **Save**.

---

## Step 9 — Store listing

Click **Store listings** → **English (United States)** (or add your preferred
language first).

Open `STORE-LISTING.md` beside you and copy each block across:

| Partner Center field | Where to copy from |
| --- | --- |
| Product name | Already filled in |
| Short description | "Short description" section |
| Description | "Description" section |
| What's new in this version | "What's new" section |
| Search terms | "Search terms" — one per box, up to 7 |
| Screenshots | The images from Step 3 |

**Screenshots are mandatory.** Upload at least one. Add a short caption to each
if you like — it helps, but is optional.

Leave Store logos, trailers and additional art blank. Your app icon comes from
the package itself.

Click **Save**.

---

## Step 10 — Submission options

Scroll to **Notes for certification** and paste the block from
`STORE-LISTING.md` under that heading.

**Do not skip this.** It tells the reviewer how to actually use your app, and —
critically — explains that the AI panel showing "no API key saved" on their clean
test machine is *expected behaviour*, not a broken feature. Without that note,
there is a genuine risk of rejection for something that is working correctly.

Click **Save**.

---

## Step 11 — Submit

Every section should now show a green tick or "Complete".

Click **Submit to the Store**.

---

## What happens next

| Stage | How long | What it is |
| --- | --- | --- |
| Pre-processing | Minutes | Automated checks on your package |
| Certification | A few hours to 3 days | Security scan, then a human tests the app |
| Publishing | A few hours | Rolling out to the Store |

You will get an email at each stage.

Once live, your app appears at:
**<https://apps.microsoft.com/detail/9N1S7QP2WNLX>**

---

## If it gets rejected

It happens, and it is not a disaster. You get a report naming the exact test that
failed.

Common causes, and what they mean:

| Report says | What it actually means |
| --- | --- |
| Privacy policy not accessible | The GitHub Pages URL was not live yet. Check Step 2 and resubmit. |
| App crashes on launch | Something in the packaged build differs from the development build. Send me the report. |
| Feature does not work as described | Usually the AI panel. Confirm the certification notes from Step 10 were pasted in. |
| Identity mismatch | Package identity vs Partner Center. One-line fix, I will handle it. |

To resubmit: fix the issue, **increase the version number** (the Store rejects a
version it has already seen), rebuild, upload, submit again. There is no penalty
and no limit on resubmissions.

Send me whatever the report says and I will tell you what to change.

---

## After it is live

- **Updates:** I bump the version and push; GitHub builds a new package; you
  upload it and submit. Existing users update automatically.
- **Analytics:** Partner Center → Analytics shows installs, ratings and crash
  reports. Crash data arrives automatically for Store apps, which is genuinely
  useful.
- **Reviews:** you can reply to reviews from Partner Center. Worth doing early
  on — it visibly signals a maintained app.

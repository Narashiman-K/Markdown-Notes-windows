# Pushing to GitHub — what to do and why

Everything is committed locally and ready. You just need to send it to GitHub,
which requires your credentials, so it has to be you rather than me.

**Total time: about 3 minutes.**

---

## What has already been done

| Step | What it means | Status |
| --- | --- | --- |
| `git init` | Turned the folder into a tracked repository | ✅ done |
| `.gitignore` | Listed files that must *never* be uploaded | ✅ done |
| `git add` | Selected the 83 files to include | ✅ done |
| `git commit` | Saved a permanent snapshot with a description | ✅ done |
| `git remote add origin` | Recorded where your GitHub repo lives | ✅ done |
| `git push` | **Uploads it to GitHub** | ⬅ **your turn** |

---

## Step 1 — Open a terminal in the project folder

Press `Win`, type **Terminal**, open it, then paste:

```powershell
cd "D:\Calude Co-work space\Build Projects\MarkNote"
```

*This just moves the terminal into the project folder, the way double-clicking
moves you into a folder in File Explorer.*

## Step 2 — Push

```powershell
git push -u origin main
```

**What each part means:**

- `git push` — upload my saved snapshot
- `-u origin main` — to the repository called `origin` (yours), on the branch
  called `main`. The `-u` remembers this, so next time plain `git push` works.

**A browser window will open asking you to sign in to GitHub.** That is expected
— it is GitHub verifying it is really you. Approve it, and the upload runs.

If no window appears and it asks for a username and password in the terminal
instead, stop: GitHub no longer accepts account passwords there. Tell me and
I'll walk you through the alternative.

## Step 3 — Check it worked

Open <https://github.com/Narashiman-K/Markdown-Notes-windows>

You should see your files and the README displayed underneath them.

## Step 4 — Watch the build run

Click the **Actions** tab.

A job called **Build** will have started automatically. This is the part that
solves the MSIX problem: GitHub's Windows machines have the Windows SDK your PC
lacks, so the Store package builds there.

It takes about 5–10 minutes and does this:

1. Installs the project's dependencies
2. Checks the code for type errors
3. Runs the 101 unit tests
4. Runs the 57 end-to-end tests against the real app
5. Builds the `.exe` installer **and the `.msix` Store package**

A green tick means everything passed. Click into the run and scroll to
**Artifacts** at the bottom — `windows-packages` contains your installer and the
MSIX file. Download it, and that is what you upload to Partner Center.

A red cross means something failed. Click the failed step to see why, and send
it to me.

---

## From then on

Whenever I change the code, you run:

```powershell
git add -A
git commit -m "short description of what changed"
git push
```

- `add -A` — include everything I changed
- `commit -m "..."` — save a snapshot with a note explaining it
- `push` — upload it

Every push re-runs all the tests automatically. If I ever break something, you
find out from a red cross rather than from a user.

---

## Two things worth knowing

**Your repository is public.** Anyone can read the code. Your licence says
personal use only, which is a legal statement rather than a technical barrier —
it does not stop copying, it just means unlicensed commercial use is a breach.
If that concerns you, Settings → General → Danger Zone → Change visibility.

**Your personal files are excluded.** While preparing this I found a
`Converted-Files` folder holding your CV, HIGH5 report and a certificate. Those
were about to be uploaded to a public repository. They are now in `.gitignore`,
so they stay on your machine. They are still in the folder — nothing was
deleted, just never sent.

If you ever add files to the project, glance at what `git add -A` picked up
before pushing:

```powershell
git status
```

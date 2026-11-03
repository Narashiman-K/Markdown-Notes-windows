# Free, private AI on your own PC with Ollama

Suprasūtā Markdown Notes can answer questions about your documents, summarise them, explain a passage and suggest annotations. It can do this with **Ollama**, a free program that runs AI models on your own computer:

- **Free:** no account, no API key, no monthly bill.
- **Private:** your documents never leave your PC.
- **Works offline** once a model is downloaded.

Paid cloud models (Claude, ChatGPT, Gemini) remain available in the app if you want them, but for everyday reading, summarising and questions a local model is enough.

---

## 1. Check your PC

| Your PC's memory (RAM) | What runs well | Suggested model |
| --- | --- | --- |
| 8 GB | Small models, short answers | `llama3.2:3b` or `gemma3:4b` |
| 16 GB | The sweet spot for most people | `llama3.1:8b` or `qwen2.5:7b` |
| 32 GB or more | Larger, more careful models | `qwen2.5:14b` or `gemma3:12b` |

To see your RAM: **Settings → System → About → Installed RAM**.

A graphics card (GPU) makes answers faster but is **not required**. Ollama works on a normal processor, including ARM laptops (Snapdragon / Copilot+ PCs).

Each model is a one-time download of about **2–9 GB**. Check you have that much free space.

---

## 2. Install Ollama

**Easiest:** download the Windows installer from **<https://ollama.com/download/windows>**, run it, and click **Install**. Ollama starts automatically and sits in the system tray (bottom right, near the clock).

**Or, from a terminal** (Windows Terminal / PowerShell):

```powershell
winget install Ollama.Ollama
```

To check it is running, open **<http://localhost:11434>** in your browser. It should say *"Ollama is running"*.

Mac and Linux installers are on the same download page: <https://ollama.com/download>.

---

## 3. Download a model

Open **Windows Terminal** or **PowerShell** and type one of these (pick the one matching your RAM from step 1):

```powershell
ollama pull llama3.2:3b     # 8 GB RAM   (~2 GB download)
ollama pull llama3.1:8b     # 16 GB RAM  (~5 GB download)
ollama pull qwen2.5:7b      # 16 GB RAM, good with Indian and other languages (~5 GB)
ollama pull gemma3:12b      # 32 GB RAM  (~8 GB download)
```

Try it straight away in the terminal:

```powershell
ollama run llama3.1:8b "Summarise in one line: Markdown is a plain-text formatting language."
```

Useful commands:

| Command | What it does |
| --- | --- |
| `ollama list` | Shows the models you have downloaded |
| `ollama rm llama3.2:3b` | Deletes a model to free disk space |
| `ollama ps` | Shows which model is loaded right now |

Browse every available model at **<https://ollama.com/library>**. Newer models appear there regularly; any of them can be used the same way.

---

## 4. Use it in Suprasūtā Markdown Notes

### Windows app (Microsoft Store)

1. Open a document.
2. Press **Ctrl+Shift+A** (or **AI → Ask your documents**).
3. The panel should show a green **"Ollama running · N models"**. If it doesn't, click **Re-check**.
4. Click the **⚙** settings icon to choose which model to use.
5. Ask a question, or use **Summarise**, **Explain selection** or **Suggest annotations**.

Nothing else is needed: the Windows app talks to Ollama directly on your PC.

### Web app (in a browser)

A website is not allowed to talk to programs on your PC unless you say so. Tell Ollama to accept the web app, once:

1. Open **PowerShell** and run:

   ```powershell
   setx OLLAMA_ORIGINS "https://markdown-notes-psi.vercel.app"
   ```

2. **Quit Ollama** (right-click its tray icon → **Quit Ollama**) and start it again from the Start menu, so it picks up the setting.
3. Reload the web app and open the AI panel.

This only works in a **desktop browser on the same PC** as Ollama. Phones and tablets cannot reach it.

---

## 5. If something goes wrong

| What you see | What to do |
| --- | --- |
| "Ollama not running on this computer" | Start **Ollama** from the Start menu, wait 10 seconds, click **Re-check** |
| "Running, but no models" | Run `ollama pull llama3.2:3b` (step 3) |
| Answers are very slow | Use a smaller model (`llama3.2:3b`); close other heavy apps; the first answer after starting is always slower while the model loads |
| Web app can't connect | Check `OLLAMA_ORIGINS` (step 4, web) and restart Ollama |
| Running out of disk space | `ollama list`, then `ollama rm <name>` for models you don't use |

To keep models on another drive (e.g. `D:`), set `OLLAMA_MODELS`:

```powershell
setx OLLAMA_MODELS "D:\Ollama\models"
```

Then quit and restart Ollama. Models already downloaded need to be moved or downloaded again.

---

## Local AI or cloud AI?

| | Ollama (local) | Claude / ChatGPT / Gemini (cloud) |
| --- | --- | --- |
| Cost | Free | Pay per use with your own API key |
| Privacy | Nothing leaves your PC | The text you ask about is sent to that company |
| Offline | Yes | No |
| Quality | Good for summaries, questions and explanations | Better on long, complex documents and careful rewriting |
| Speed | Depends on your PC | Usually fast |

Start local; switch to a cloud model in the ⚙ settings only for the jobs that need it.

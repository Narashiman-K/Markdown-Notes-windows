---
title: Privacy Policy
---

# Privacy Policy

**Suprasūtā Markdown Notes**

Last updated: 20 August 2026

---

## The short version

This application stores everything on your own computer. It does not collect,
transmit or sell your personal information. There is no analytics, no telemetry
and no advertising.

Three optional features can send data to a third party, but **only** if you
switch them on and supply your own credentials. Each is described below.

---

## Who is responsible

Suprasūtā Markdown Notes is published by **Narashiman Krishnamurthy**
("the publisher", "we").

Contact: <https://www.linkedin.com/in/narashimank/>

---

## What the application stores, and where

Everything below is stored **locally on your device only**. None of it is
transmitted to the publisher.

| Data | Where it is stored | Why |
| --- | --- | --- |
| Your documents and annotations | Wherever you choose to save them | They are your files |
| Application settings (theme, zoom, default folders) | `%APPDATA%\Suprasuta Markdown Notes\settings.json` | To remember your preferences |
| List of recently opened files | Same settings file | Convenience |
| API keys you choose to enter | Same settings file, **encrypted** | To use the optional cloud features |
| AI conversations | In memory only, discarded when the app closes | They are not saved anywhere |

**API keys are encrypted using Windows Data Protection API (DPAPI)** via
Electron's `safeStorage`. The encrypted value can only be decrypted by the same
Windows user account on the same machine. Copying the settings file to another
computer yields nothing usable. Keys are never transmitted to the publisher and
never leave your machine except to the provider you chose.

## What the publisher receives

**Nothing.** The application has no server, no account system and no analytics.
The publisher cannot see your documents, your settings, your API keys, whether
you use the app, or that you have installed it at all.

If you contact the publisher, or open an issue on the project's GitHub page, you
share whatever information you choose to include in that message. That is
entirely voluntary and governed by GitHub's own privacy policy.

---

## Optional features that use the internet

All three are **disabled by default**. Nothing is sent anywhere until you
explicitly enable a feature and provide your own API key.

### 1. AI assistant (optional)

The AI panel can answer questions about documents you have loaded.

- **If you choose Ollama** (the default): the model runs on your own computer.
  Nothing leaves your machine at all.
- **If you choose Anthropic, OpenAI or Google Gemini**: you supply your own API
  key, and the passages relevant to your question are sent to **that provider
  only**, for them to generate an answer. Your whole file is not sent — only the
  passages selected as context, and only at the moment you ask a question.

The publisher is not a party to this. You are using your own account with that
provider, under their terms and their privacy policy:

- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/)
- [Google Privacy Policy](https://policies.google.com/privacy)

### 2. Reading text from images (optional)

Converting an image to Markdown requires optical character recognition.

- **Offline mode**: performed entirely on your computer. Nothing is uploaded.
- **Cloud mode**: the image is sent to **Google Gemini** using your own API key,
  which returns the extracted text.

You choose which mode to use each time, and the application states clearly which
one is selected before converting.

### 3. Audio transcription (optional)

This is the only feature that **cannot** run offline. Speech recognition of
usable quality requires a cloud service.

If you convert an audio file, that audio file is **uploaded to AssemblyAI** using
your own API key, and their service returns a transcript. The application
displays a prominent warning and requires you to tick a confirmation box before
any audio is uploaded.

AssemblyAI's handling of that data is governed by
[their privacy policy](https://www.assemblyai.com/legal/privacy-policy).

---

## Children

This application is a general-purpose writing tool. It is not directed at
children, and it does not knowingly collect information from anyone, including
children.

---

## Your rights

Because the publisher holds no data about you, there is nothing for us to
disclose, correct, export or delete on your behalf.

You remain in full control of everything the application stores:

- **To delete your settings and stored API keys**: delete the folder
  `%APPDATA%\Suprasuta Markdown Notes`
- **To remove an individual API key**: use the "Remove" option beside it in the
  AI settings panel
- **To delete your documents**: they are ordinary files; delete them as you would
  any other

If you have used an optional cloud feature and wish to exercise data rights
against that provider, contact the provider directly, as they are the controller
for the data you sent them.

Under the UK GDPR and EU GDPR, where the publisher processes no personal data,
there is no controller relationship in respect of your use of the application.
Where you enable an optional cloud feature, you are transmitting your own data to
a provider under your own account.

---

## Security

- All application code runs with Electron context isolation enabled and Node.js
  integration disabled.
- A strict Content Security Policy is enforced in the user interface.
- Rendered document content is sanitised before display.
- API keys are held only in the application's background process and are never
  made available to the user interface layer.
- The application is open source; the code implementing all of the above can be
  inspected at
  <https://github.com/Narashiman-K/Markdown-Notes-windows>.

---

## Changes to this policy

If this policy changes, the revised version will be published at this address
with an updated date at the top. Material changes affecting how data is handled
will also be noted in the application's release notes.

---

## Contact

Questions about this policy:
[Narashiman Krishnamurthy on LinkedIn](https://www.linkedin.com/in/narashimank/)
or via the
[project's GitHub issues page](https://github.com/Narashiman-K/Markdown-Notes-windows/issues).

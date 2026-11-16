# Setting up anonymous usage statistics (PostHog, EU)

The app is ready to send anonymous usage counts, but it sends **nothing** until a
PostHog project key is put into `src/renderer/src/lib/analytics.ts` (Windows) and
`src/lib/analytics.ts` (web). It takes about 10 minutes, it's free (1 million
events a month), and you only have to do it once.

## 1. Create the account in the EU region

1. Go to <https://eu.posthog.com/signup>. The `eu.` part matters: it keeps the data
   in the European Union.
2. Sign up with the app's e-mail address (naraforapps@gmail.com), not your personal one.
3. Organisation name: `Suprasuta`. Project name: `Markdown Notes`.
4. When it asks what you want to use, pick **Product analytics** only. Skip the
   "install the snippet" step. The app doesn't need PostHog's script.

## 2. Switch off everything the app doesn't need

In **Settings → Project** (gear icon, bottom left):

| Setting | Set to | Why |
| --- | --- | --- |
| **Discard client IP data** | **On** | No IP addresses are kept, as the privacy policy says |
| Autocapture (web) | Off | The app sends its own counts |
| Session replay | Off | Never record screens |
| Heatmaps, surveys, web vitals | Off | Not used |
| Data retention (if offered) | 12 months | Enough to see trends |

## 3. Copy the project key

**Settings → Project → Project API key**. It starts with `phc_`.

This key is public by design: it can only *send* events, it can't read any data.
You can safely paste it into the chat with me, unlike the free LLM API keys.

## 4. Put the key in the app

Send me the `phc_…` key and I'll put it in both apps. If you'd rather do it
yourself, open both `analytics.ts` files and change

```ts
export const POSTHOG_KEY = ''
```

to

```ts
export const POSTHOG_KEY = 'phc_your_key_here'
```

## 5. Check it works

Development builds never send anything. To check:

1. Build the app (or open the deployed web app).
2. Open a document and use a few commands (Save, Mind map, Read aloud).
3. Within about a minute, PostHog's **Activity** page shows `app_opened` and
   `command` events. Each `command` event has a `name` such as `file:save`.
4. Switch it off with **Help → Send anonymous usage statistics** and check that
   no more events arrive.

## Useful views to make in PostHog

- **Trends → `command`, broken down by `name`**: which features people use most.
- **Trends → `app_opened`, broken down by `platform`**: Windows app vs web.
- **Trends → `app_opened`, unique users per week**: how many people use the app.

## What is sent (as the privacy policy says)

- `app_opened`: app version, `windows` or `web`, screen size (small, medium or large), interface language.
- `command`: the command's internal name only (for example `view:mindmap`). Never its argument, because some arguments are file paths.
- Every event is anonymous (`$process_person_profile: false`) and comes from a random device ID, not linked to anyone.

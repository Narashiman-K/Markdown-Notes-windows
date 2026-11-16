/**
 * Anonymous usage statistics.
 *
 * What is sent: that the app was opened (app version, Windows app or web,
 * screen size bucket, language) and which commands are used, by their
 * internal names ("file:save", "view:mindmap"). Counts only.
 *
 * Never sent: document text, file or folder names, notes, AI questions or
 * answers, keys, names, e-mail addresses. Command *arguments* are never sent,
 * because some carry a path. The identifier is a random number made on this
 * device, not linked to any account; deleting the app's data makes a new one.
 *
 * Where: PostHog, EU hosting. The project is set to discard IP addresses, and
 * each event is marked as anonymous ($process_person_profile: false).
 *
 * Off switch: Help → Send anonymous usage statistics. Off means nothing is
 * sent, and anything queued is dropped. With no project key configured, or in
 * a development build, nothing is ever sent.
 */

/** PostHog project key (public by design: it can only send events). Empty = analytics off. */
export const POSTHOG_KEY = ''
const HOST = 'https://eu.i.posthog.com'

const ON = 'mn-analytics'
const ID = 'mn-analytics-id'
const NOTICE = 'mn-analytics-notice'

interface Event {
  event: string
  properties: Record<string, string | number | boolean | null>
  timestamp: string
}

let queue: Event[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let platformName = 'web'
let version = ''

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Configured, and not a development build. */
export function analyticsAvailable(): boolean {
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
  return POSTHOG_KEY !== '' && !dev
}

/** On by default; the reader's choice is kept on this device. */
export function analyticsOn(): boolean {
  return store()?.getItem(ON) !== 'off'
}

export function setAnalytics(on: boolean): void {
  store()?.setItem(ON, on ? 'on' : 'off')
  if (!on) {
    queue = []
    if (timer) clearTimeout(timer)
    timer = null
  }
}

/** True once: the first launch, so the app can show its one-line notice. */
export function analyticsNoticeDue(): boolean {
  const s = store()
  if (!s || !analyticsAvailable() || s.getItem(NOTICE)) return false
  s.setItem(NOTICE, '1')
  return true
}

function anonId(): string {
  const s = store()
  let id = s?.getItem(ID)
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace('.', '')
    s?.setItem(ID, id)
  }
  return id
}

/** Only the command's name, and only names that look like one. */
export function commandName(action: string): string | null {
  return /^[a-z]+(:[a-zA-Z0-9-]+){0,3}$/.test(action) && action.length <= 48 ? action : null
}

export function track(event: string, properties: Event['properties'] = {}): void {
  if (!analyticsAvailable() || !analyticsOn()) return
  queue.push({ event, properties, timestamp: new Date().toISOString() })
  if (queue.length >= 30) void flush()
  else timer ??= setTimeout(() => void flush(), 60_000)
}

export async function flush(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  if (!queue.length || !analyticsAvailable() || !analyticsOn()) return
  const distinct = anonId()
  const batch = queue.splice(0).map((e) => ({
    ...e,
    distinct_id: distinct,
    properties: { ...e.properties, $process_person_profile: false, $ip: null, platform: platformName, app_version: version }
  }))
  try {
    await fetch(`${HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
      keepalive: true,
      credentials: 'omit'
    })
  } catch {
    /* offline: these counts are simply lost */
  }
}

/** Call once at start. */
export function startAnalytics(platform: 'windows' | 'web', appVersion: string): void {
  platformName = platform
  version = appVersion
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush()
    })
  }
  const w = typeof window !== 'undefined' ? window.innerWidth : 0
  track('app_opened', {
    screen: w < 700 ? 'small' : w < 1300 ? 'medium' : 'large',
    language: typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : ''
  })
}

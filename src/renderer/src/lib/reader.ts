/**
 * Reader mode: the settings behind it, and the CSS variables they produce.
 *
 * Everything reading-related is expressed as custom properties on the root
 * element rather than as classes per combination. Width, size, spacing and
 * palette are independent choices, and enumerating their combinations in CSS
 * would be dozens of rules that all have to agree with each other.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */

export type ReaderWidth = 'narrow' | 'medium' | 'wide'
export type ReaderSize = 'small' | 'normal' | 'large' | 'huge'
export type ReaderSpacing = 'tight' | 'normal' | 'relaxed'

/**
 * `auto` follows the application's own light or dark setting, which in turn
 * can follow the operating system. It is the default because the common case
 * is wanting to read comfortably in whatever the device is already doing:
 * light text on a dark screen at night, dark text on a light screen by day.
 *
 * The rest are deliberate overrides that ignore the device.
 */
export type ReaderPalette = 'auto' | 'paper' | 'sepia' | 'night' | 'contrast'

export interface ReaderSettings {
  width: ReaderWidth
  size: ReaderSize
  spacing: ReaderSpacing
  palette: ReaderPalette
}

export const DEFAULT_READER: ReaderSettings = {
  width: 'medium',
  size: 'normal',
  spacing: 'normal',
  palette: 'auto'
}

/** Measure, in characters. Roughly 60-75 is the readable range for prose. */
const WIDTH: Record<ReaderWidth, string> = {
  narrow: '34rem',
  medium: '44rem',
  wide: '56rem'
}

const SIZE: Record<ReaderSize, string> = {
  small: '17px',
  normal: '19px',
  large: '22px',
  huge: '26px'
}

const SPACING: Record<ReaderSpacing, string> = {
  tight: '1.5',
  normal: '1.75',
  relaxed: '2.05'
}

interface Palette {
  bg: string
  fg: string
  muted: string
  rule: string
  link: string
  /** Panels, code blocks and table headers sit slightly off the page colour. */
  raised: string
}

/*
 * Each palette is a complete set rather than a tweak of the app theme.
 *
 * Reading colours are not interface colours: the page wants lower contrast
 * between background and text than a toolbar does, because maximum contrast
 * over a long passage is tiring rather than clear. Pure black on pure white
 * is deliberately absent for that reason — `contrast` exists for people who
 * need it, and is not the default for people who do not.
 */
const PALETTES: Record<Exclude<ReaderPalette, 'auto'>, Palette> = {
  paper: {
    bg: '#fbfbfa',
    fg: '#22242a',
    muted: '#6b7280',
    rule: '#e3e3e0',
    link: '#0b5fb0',
    raised: '#f2f2ef'
  },
  sepia: {
    bg: '#f6efe2',
    fg: '#3a3227',
    muted: '#7c6f5c',
    rule: '#e3d8c4',
    link: '#8a5a1f',
    raised: '#efe6d4'
  },
  night: {
    bg: '#16181b',
    fg: '#d6dae1',
    muted: '#8b93a1',
    rule: '#2b2f36',
    link: '#6db2ff',
    raised: '#1e2126'
  },
  contrast: {
    bg: '#000000',
    fg: '#ffffff',
    muted: '#c8c8c8',
    rule: '#4a4a4a',
    link: '#79c0ff',
    raised: '#141414'
  }
}

/**
 * Resolves `auto` against whether the application is currently dark.
 *
 * This is the inversion behaviour: a dark device gets light text on a dark
 * page, a light device gets dark text on a light page, without the reader
 * having to choose. The other palettes are explicit and ignore the device.
 */
export function resolvePalette(palette: ReaderPalette, dark: boolean): Palette {
  if (palette === 'auto') return dark ? PALETTES.night : PALETTES.paper
  return PALETTES[palette]
}

/** The custom properties to set on the root element while reading. */
export function readerVariables(
  settings: ReaderSettings,
  dark: boolean
): Record<string, string> {
  const p = resolvePalette(settings.palette, dark)
  return {
    '--reader-width': WIDTH[settings.width],
    '--reader-size': SIZE[settings.size],
    '--reader-leading': SPACING[settings.spacing],
    '--reader-bg': p.bg,
    '--reader-fg': p.fg,
    '--reader-muted': p.muted,
    '--reader-rule': p.rule,
    '--reader-link': p.link,
    '--reader-raised': p.raised
  }
}

/** Applies or clears the reading variables. Safe to call on every render. */
export function applyReaderVariables(
  on: boolean,
  settings: ReaderSettings,
  dark: boolean
): void {
  const root = document.documentElement
  if (!on) {
    root.removeAttribute('data-reader')
    for (const name of Object.keys(readerVariables(DEFAULT_READER, dark))) {
      root.style.removeProperty(name)
    }
    return
  }
  root.setAttribute('data-reader', 'on')
  for (const [name, value] of Object.entries(readerVariables(settings, dark))) {
    root.style.setProperty(name, value)
  }
}

const ORDER = {
  width: ['narrow', 'medium', 'wide'] as ReaderWidth[],
  size: ['small', 'normal', 'large', 'huge'] as ReaderSize[],
  spacing: ['tight', 'normal', 'relaxed'] as ReaderSpacing[]
}

/**
 * Steps one setting up or down, stopping at the ends.
 *
 * Clamping rather than wrapping: pressing "larger" repeatedly should end at
 * the largest, not silently return to the smallest.
 */
export function step<K extends keyof typeof ORDER>(
  settings: ReaderSettings,
  key: K,
  direction: 1 | -1
): ReaderSettings {
  const values = ORDER[key] as readonly string[]
  const at = values.indexOf(settings[key] as string)
  const next = values[Math.min(values.length - 1, Math.max(0, at + direction))]
  return { ...settings, [key]: next }
}

/*
 * Only three are offered.
 *
 * Paper and night still exist, because auto resolves to them, but they were
 * confusing as separate buttons: the application already has a light and dark
 * theme, so offering "Paper" and "Night" alongside it gave two controls for
 * one decision and left people wondering why changing the theme appeared to
 * do nothing. Auto follows the theme; the other two are deliberate overrides
 * that ignore it, which is a distinction worth keeping small.
 */
export const PALETTE_LABELS: Array<{ value: ReaderPalette; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'Follows your light or dark theme' },
  { value: 'sepia', label: 'Sepia', hint: 'Warm page, easier on the eyes' },
  { value: 'contrast', label: 'High contrast', hint: 'Maximum legibility' }
]

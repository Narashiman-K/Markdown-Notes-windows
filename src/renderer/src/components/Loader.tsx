/**
 * The app's busy indicator: the animated Suprasūtā logo.
 *
 * Two versions of the same drawing — light strokes for dark backgrounds, dark
 * strokes for light ones — and CSS shows whichever matches the theme, keyed on
 * the `.app.dark` class the root element already carries. Both are tiny SVGs,
 * so carrying the unused one costs nothing, and switching theme mid-wait
 * swaps the drawing without a reload.
 *
 * Loaded as plain <img> sources. That is also what keeps them inert: an SVG
 * shown through <img> cannot run script, whatever it contains.
 *
 * Kept identical to the copy in the Windows app. Change one, copy it across.
 */
import onLight from '../assets/preloader/loader-on-light.svg'
import onDark from '../assets/preloader/loader-on-dark.svg'

export default function Loader(props: { size?: number; label?: string; inline?: boolean }): JSX.Element {
  const size = props.size ?? 40
  // The drawing's viewBox is 100 x 120.
  const height = Math.round(size * 1.2)
  return (
    <span className={`loader${props.inline ? ' inline' : ''}`} role="status" aria-live="polite">
      <img className="loader-img loader-on-light" src={onLight} width={size} height={height} alt="" />
      <img className="loader-img loader-on-dark" src={onDark} width={size} height={height} alt="" />
      {props.label ? <span className="loader-label">{props.label}</span> : <span className="sr-only">Working…</span>}
    </span>
  )
}

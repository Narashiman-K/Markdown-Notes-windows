import { useEffect, useState } from 'react'
import logoMark from '../assets/logo-mark.png'
import { AUTHOR, LINKEDIN_URL, SIGNATURE } from '../lib/signature'
import { APP_DISPLAY_NAME, TAGLINE, STORE_REVIEW_URL } from '../../../shared/brand'

interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
}

interface Props {
  onClose: () => void
}

export default function AboutDialog({ onClose }: Props): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.api.appInfo().then(setInfo)
  }, [])

  const open = (url: string) => (e: React.MouseEvent): void => {
    e.preventDefault()
    window.open(url, '_blank')
  }

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onClose}>
      <div className="modal about-modal" onMouseDown={(e) => e.stopPropagation()} data-signature={SIGNATURE}>
        <div className="about-head">
          <img className="about-logo" src={logoMark} alt={APP_DISPLAY_NAME} draggable={false} />
          <div>
            <h2>{APP_DISPLAY_NAME}</h2>
            <p className="muted small">
              {TAGLINE}
              {info ? ` · Version ${info.version}` : ''}
            </p>
          </div>
        </div>

        <div className="about-body">
          <p>
            Created by <strong>{AUTHOR}</strong>
          </p>

          <p>
            Free to use for <strong>personal use</strong>. Not licensed for commercial purposes.
          </p>

          <p>
            Please do comment and give it <strong>5 stars</strong> if you like it. Thanks!{' '}
            <a href={STORE_REVIEW_URL} onClick={open(STORE_REVIEW_URL)}>
              Write a review
            </a>
          </p>

          <p>
            <a href={LINKEDIN_URL} onClick={open(LINKEDIN_URL)}>
              Narashiman Krishnamurthy | LinkedIn
            </a>
          </p>

          {info && (
            <p className="muted small about-versions">
              Electron {info.electron} · Chromium {info.chrome} · Node {info.node}
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

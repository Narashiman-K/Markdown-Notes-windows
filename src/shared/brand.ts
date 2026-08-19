/**
 * Single source of truth for product identity.
 *
 * The display name keeps its macrons because it is only ever rendered as text.
 * Anything that becomes a path, package identity, domain or registry key must
 * stay ASCII, so those use the transliterated form.
 */
export const BRAND_NAME = 'Suprasūtā'
export const BRAND_NAME_ASCII = 'Suprasuta'
export const BRAND_MEANING = 'Generating excellent, high-quality outputs abundantly'

export const APP_DISPLAY_NAME = 'Suprasūtā Markdown Notes'
export const APP_SHORT_NAME = 'Suprasūtā Notes'
export const APP_ASCII_NAME = 'Suprasuta Markdown Notes'
export const APP_ID = 'com.suprasuta.markdownnotes'

export const AUTHOR = 'Narashiman Krishnamurthy'
export const LINKEDIN_URL = 'https://www.linkedin.com/in/narashimank/'
export const LICENCE_NOTE = 'Free for personal use. Not licensed for commercial use.'
export const TAGLINE = 'Markdown viewer, editor, annotator and AI reading companion'

export const REPO_URL = 'https://github.com/Narashiman-K/Markdown-Notes-windows'

/**
 * Opens a pre-filled GitHub issue so interest in the planned repo-to-docs
 * feature can actually be counted, rather than guessed at.
 */
export function featureRequestUrl(): string {
  const title = 'Feature request: generate documentation from a code project'
  const body = [
    '<!-- Thanks for voting. Add or delete anything below, then press Submit. -->',
    '',
    '**I would use a feature that reads a code project and writes documentation.**',
    '',
    'I would point it at (tick any):',
    '- [ ] a GitHub repository URL',
    '- [ ] a folder on my computer',
    '',
    'What I would want it to produce:',
    '- [ ] a user manual',
    '- [ ] technical/developer documentation',
    '- [ ] a plain-English summary of what the project does',
    '- [ ] something else (describe below)',
    '',
    '**Anything else you want it to do:**',
    '',
    ''
  ].join('\n')

  return `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('feature-vote')}`
}

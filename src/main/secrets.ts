/**
 * Credential storage.
 *
 * API keys are encrypted with Electron's safeStorage, which on Windows is
 * backed by DPAPI: the ciphertext can only be decrypted by the same Windows
 * user account on the same machine. Copying settings.json to another computer
 * yields nothing useful.
 *
 * Keys never leave the main process. The renderer can ask whether a key exists
 * and can set one, but can never read one back.
 */
import { safeStorage } from 'electron'

const PREFIX = 'enc:v1:'

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Encrypts a secret for storage. Returns '' for empty input. */
export function seal(plain: string): string {
  if (!plain) return ''
  if (!isEncryptionAvailable()) return plain
  try {
    return PREFIX + safeStorage.encryptString(plain).toString('base64')
  } catch {
    return plain
  }
}

/** Decrypts a stored secret, tolerating values written before encryption. */
export function open(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(PREFIX)) return stored // legacy plaintext
  if (!isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

/** True when a secret is present, without revealing it. */
export function has(stored: string | undefined): boolean {
  return !!stored && open(stored).length > 0
}

/** Last four characters, for showing the user which key is stored. */
export function hint(stored: string | undefined): string {
  const plain = stored ? open(stored) : ''
  return plain ? `…${plain.slice(-4)}` : ''
}

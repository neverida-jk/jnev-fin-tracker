// A screen lock, not encryption: this gates the app's UI behind a PIN so a
// phone picked up by someone else can't casually browse your balances and
// transactions. It does NOT protect the underlying IndexedDB data itself —
// anyone with devtools/filesystem access to the device could still read it,
// same as before this existed. That's also why "forgot PIN" is safe to make
// a no-questions-asked reset: it only ever turns the screen lock off, never
// touches financial data.

const PIN_HASH_KEY = 'app-lock-pin-hash'

export function isCryptoSupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}

export function isLockEnabled(): boolean {
  try {
    return localStorage.getItem(PIN_HASH_KEY) !== null
  } catch {
    return false
  }
}

async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Sets (or replaces) the app lock PIN. Requires at least 4 digits — not for
 * strength against a determined attacker (see the note above), just enough
 * to not be a trivial 1-2 digit guess. */
export async function setPin(pin: string): Promise<void> {
  if (!isCryptoSupported()) {
    throw new Error('This browser does not support the app lock feature.')
  }
  if (!/^\d{4,}$/.test(pin)) {
    throw new Error('Use at least 4 digits.')
  }
  localStorage.setItem(PIN_HASH_KEY, await hashPin(pin))
}

/** Turns the lock off. Never touches any financial data — see the module
 * note above for why this has no confirmation step of its own (the caller,
 * e.g. a "Forgot PIN?" prompt, should still confirm with the user first). */
export function disableLock(): void {
  try {
    localStorage.removeItem(PIN_HASH_KEY)
  } catch {
    // no-op — if it couldn't be read, there's nothing to remove
  }
}

/** Checks a candidate PIN against the stored hash. Returns true if no lock
 * is set — nothing to fail against. */
export async function verifyPin(pin: string): Promise<boolean> {
  let stored: string | null
  try {
    stored = localStorage.getItem(PIN_HASH_KEY)
  } catch {
    return false
  }
  if (!stored) return true
  if (!isCryptoSupported()) return false
  return (await hashPin(pin)) === stored
}

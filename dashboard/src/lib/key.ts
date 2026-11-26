/**
 * The space key is the only thing that grants access to your data (there is no
 * sign-in). It arrives once in the link fragment (#k=...), which browsers never
 * send to a server, is saved in this browser, and is then removed from the
 * address bar so it does not end up in screenshots or history.
 */
const STORAGE = "jobfinder.spaceKey";
export const MIN_KEY_LENGTH = 32;

export function isValidKey(k: string): boolean {
  return k.length >= MIN_KEY_LENGTH && k.length <= 200 && /^[A-Za-z0-9_-]+$/.test(k);
}

/** Pull the key out of a "#k=..." fragment, if present. */
export function keyFromHash(hash: string): string | null {
  const m = /^#k=([A-Za-z0-9_-]+)$/.exec(hash);
  return m && isValidKey(m[1]!) ? m[1]! : null;
}

export function readKey(): string | null {
  const fromLink = keyFromHash(window.location.hash);
  if (fromLink) {
    saveKey(fromLink);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromLink;
  }
  try {
    const k = window.localStorage.getItem(STORAGE);
    return k && isValidKey(k) ? k : null;
  } catch {
    return null;
  }
}

export function saveKey(k: string): void {
  try {
    window.localStorage.setItem(STORAGE, k);
  } catch {
    // Private mode: the key lasts for this page load only.
  }
}

export function forgetKey(): void {
  try {
    window.localStorage.removeItem(STORAGE);
  } catch {
    // nothing stored
  }
}

/** 32 random bytes, base64url: 43 characters. */
export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function linkWithKey(k: string): string {
  return `${window.location.origin}/#k=${k}`;
}

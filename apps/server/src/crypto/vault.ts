/** AES-256-GCM encryption helpers using the Web Crypto API. */

const ALGO = "AES-GCM";
const KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt"];

async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(hexKey.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, KEY_USAGES);
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * The returned string is base64(iv) + ':' + base64(ciphertext).
 */
export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);

  // ponytail: Array.from avoids RangeError from spread into String.fromCharCode on large buffers
  const toB64 = (buf: Uint8Array) => btoa(Array.from(buf, (b) => String.fromCharCode(b)).join(""));
  const ivB64 = toB64(iv);
  const ctB64 = toB64(new Uint8Array(cipherBuffer));

  return `${ivB64}:${ctB64}`;
}

/**
 * Decrypts a value produced by {@link encrypt}.
 */
export async function decrypt(ciphertext: string, hexKey: string): Promise<string> {
  const [ivB64, ctB64] = ciphertext.split(":");
  if (!ivB64 || !ctB64) throw new Error("Invalid ciphertext format");

  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));

  const key = await importKey(hexKey);
  const plainBuffer = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ct);

  return new TextDecoder().decode(plainBuffer);
}

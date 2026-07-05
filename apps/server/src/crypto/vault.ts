/** AES-256-GCM encryption helpers using the Web Crypto API. */

const ALGO = "AES-GCM";
const KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt"];

// latin1 decodes each byte as-is, making the string btoa-safe without an Array.from loop
const u8ToB64 = (u8: Uint8Array) => btoa(new TextDecoder("latin1").decode(u8));

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

  const ivB64 = u8ToB64(iv);
  const ctB64 = u8ToB64(new Uint8Array(cipherBuffer));

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

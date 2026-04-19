import { encrypt, decrypt } from "./vault";
import { env } from "../env";

export function splitCiphertext(combined: string): { iv: string; data: string } {
  const [iv, ...rest] = combined.split(":");
  if (!iv || rest.length === 0) throw new Error("invalid ciphertext");
  return { iv, data: rest.join(":") };
}

export function joinCiphertext(
  iv: string | null | undefined,
  data: string | null | undefined,
): string | null {
  if (!iv || !data) return null;
  return `${iv}:${data}`;
}

export async function encryptJson(value: unknown): Promise<{ iv: string; data: string }> {
  const combined = await encrypt(JSON.stringify(value), env.ENCRYPTION_KEY);
  return splitCiphertext(combined);
}

export async function decryptJson(iv: string | null, data: string | null): Promise<unknown> {
  const combined = joinCiphertext(iv, data);
  if (!combined) return null;
  const plain = await decrypt(combined, env.ENCRYPTION_KEY);
  return JSON.parse(plain);
}

/** Like `decryptJson` but falls back to the raw string when JSON parsing fails. */
export async function decryptField(iv: string | null, data: string | null): Promise<unknown> {
  const combined = joinCiphertext(iv, data);
  if (!combined) return null;
  const plain = await decrypt(combined, env.ENCRYPTION_KEY);
  try {
    return JSON.parse(plain);
  } catch {
    return plain;
  }
}

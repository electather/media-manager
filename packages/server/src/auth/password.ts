import { argon2id, argon2Verify } from "hash-wasm";

/**
 * Custom password hashing via argon2id.
 *
 * Better-auth defaults to scrypt (see `node_modules/better-auth/dist/.../hash.mjs`),
 * which is memory-intensive and runs purely in JS on Cloudflare Workers' V8
 * isolate. Login flows on `app-nightly` were hitting the 30 s CPU time limit
 * (`Worker exceeded CPU time limit`) every time `sign-in/email` ran the scrypt
 * verify path. argon2id via `hash-wasm` runs as WebAssembly — measured well
 * under 200 ms per hash/verify on Workers — and is OWASP's recommended
 * password-hashing algorithm for new applications.
 *
 * Parameters follow OWASP's 2024 argon2id baseline (memory ≥ 19 MiB,
 * iterations ≥ 2, parallelism 1). These are tuned for Workers' 128 MiB
 * isolate memory envelope; tightening them further saves single-digit
 * milliseconds and weakens brute-force resistance.
 */
const PARAMS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19456, // KiB ≈ 19 MiB
  hashLength: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password,
    salt,
    parallelism: PARAMS.parallelism,
    iterations: PARAMS.iterations,
    memorySize: PARAMS.memorySize,
    hashLength: PARAMS.hashLength,
    outputType: "encoded",
  });
}

export async function verifyPassword({
  password,
  hash,
}: {
  password: string;
  hash: string;
}): Promise<boolean> {
  // `argon2Verify` parses the embedded PHC string (`$argon2id$v=19$m=...`) and
  // re-derives using the parameters carried in the hash, so rotating `PARAMS`
  // above does not break verification of older hashes produced under the
  // previous tuning.
  return argon2Verify({ password, hash });
}

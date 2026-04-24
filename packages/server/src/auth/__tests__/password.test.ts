import { describe, it, expect } from "vite-plus/test";
import { hashPassword, verifyPassword } from "../password";

describe("argon2id password hashing", () => {
  it("produces a PHC-format argon2id string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    // Format: $argon2id$v=19$m=...,t=...,p=...$<salt-b64>$<hash-b64>
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[^$]+\$[^$]+$/);
  });

  it("produces distinct hashes for the same password due to random salts", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
  });

  it("verifies a password it just hashed", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const ok = await verifyPassword({ password: "correct horse battery staple", hash });
    expect(ok).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const ok = await verifyPassword({ password: "wrong password", hash });
    expect(ok).toBe(false);
  });

  it("is case-sensitive", async () => {
    const hash = await hashPassword("CaseSensitive");
    const ok = await verifyPassword({ password: "casesensitive", hash });
    expect(ok).toBe(false);
  });

  it("handles unicode passwords", async () => {
    const pw = "pässwörd-🔐-你好";
    const hash = await hashPassword(pw);
    expect(await verifyPassword({ password: pw, hash })).toBe(true);
    expect(await verifyPassword({ password: "pässwörd-🔐-你", hash })).toBe(false);
  });

  it("verifies hashes that encode their own parameters (forward-compat with param tuning)", async () => {
    // Even if a future code change raises memory / iterations, historical
    // hashes stay verifiable because argon2Verify reads the parameters out of
    // the PHC string rather than trusting the caller's current constants.
    const hash = await hashPassword("portable");
    // Simulate an older hash with lower memory cost by constructing it directly.
    const { argon2id } = await import("hash-wasm");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const legacyHash = await argon2id({
      password: "portable",
      salt,
      parallelism: 1,
      iterations: 1,
      memorySize: 8192,
      hashLength: 32,
      outputType: "encoded",
    });
    expect(await verifyPassword({ password: "portable", hash })).toBe(true);
    expect(await verifyPassword({ password: "portable", hash: legacyHash })).toBe(true);
  });
});

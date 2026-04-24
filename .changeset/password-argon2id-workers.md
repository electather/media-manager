---
"@ent-mcp/server": patch
---

Swap the better-auth default scrypt password hash for argon2id (via
`hash-wasm`). Better-auth's stock scrypt runs purely in JS on Cloudflare
Workers' V8 isolate and blows the 30 s CPU budget on every
`/api/auth/sign-in/email` call, producing "Worker exceeded CPU time
limit" errors. argon2id via WebAssembly runs in well under 200 ms per
hash/verify and is OWASP's recommended algorithm for new applications.

**Migration note:** any user whose password hash was produced by the
previous scrypt implementation will need to be recreated (the
`create-user.yml` workflow on nightly / production). Scrypt hashes
cannot be verified by argon2id. New sign-ups and any users created
after this lands work normally.

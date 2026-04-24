---
"@ent-mcp/server": patch
---

Fix deployed-Worker login failing with `BetterAuthError: Failed to decrypt private key`. The temporary `create-user` script now writes `user` + `account` rows directly via drizzle instead of calling `auth.api.signUpEmail()`, so it no longer boots better-auth, no longer loads the `jwt` plugin, and no longer generates a JWKS keypair encrypted with whatever `BETTER_AUTH_SECRET` the script happened to run with. The `account` row it writes still uses `providerId: "credential"` with an argon2id hash, matching exactly what the runtime sign-in path looks up.

---
"@ent-mcp/server": minor
---

Implement the `x-private` JSON Schema extension for connection `userConfig`. Properties marked `"x-private": true` are stored plaintext but stripped from every `connection.list` and `connection.getUserConfig` response. Merge-on-update semantics mirror `x-secret` — an omitted `x-private` field on `connection.updateUserConfig` preserves the stored value. A field may carry both `x-secret` and `x-private`; stripping is idempotent and encryption-at-rest still applies via `x-secret`. Needed by plugins like Plex/Jellyfin that track an `internalServerUrl` that must not leak to the browser.

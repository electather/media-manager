---
"@ent-mcp/server": patch
---

Fix Jellyfin (and any future form-auth plugin with `x-allowed-host`) rejecting every valid user-supplied server URL with `host not in allowlist`. `runAuth` now threads the submitted `userConfig` into `buildAuxContext` so `x-allowed-host` hostnames are resolved against the form submission when `startAuth` fires, not just during capability invocations with an already-persisted connection. Moves `buildAuxContext` inside the catch boundary so a malformed URL also comes back as a structured auth-result error instead of escaping as an uncaught 500.

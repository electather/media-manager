---
"@ent-mcp/server": minor
---

Honor the `x-allowed-host` JSON Schema extension in `ctx.fetch`. Properties marked `"x-allowed-host": true` in a plugin's `userConfigSchema` or `sharedCredentialsSchema` now have their URL hostnames automatically unioned into the per-invocation `ctx.fetch` allowlist, alongside the plugin's static `manifest.allowedHosts`. Self-hosted plugins (Plex, Jellyfin, Sonarr/Radarr, etc.) can now reach arbitrary user-supplied servers without declaring `allowedHosts: ["*"]`. Malformed URLs in `x-allowed-host` fields fail the call with `plugin.input_invalid`.

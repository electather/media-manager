---
"@ent-mcp/server": minor
---

Add the Jellyfin built-in plugin covering libraryAvailability, playback, playbackSessions, continueWatching, watchHistory, libraryAdmin, and idResolve capabilities. The plugin authenticates users against Jellyfin's AuthenticateByName endpoint, caches the resolved Jellyfin user id on userConfig, post-filters /Sessions results to the cached user for privacy, and keeps server-to-server fetches on the internal URL while building every player/web link from the external URL. To support server-resolved identifiers during auth, the AuthResult "completed" variant now carries an optional userConfigPatch that the form/redirect/device auth completion paths merge into the stored userConfig.

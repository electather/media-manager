---
"@ent-mcp/server": minor
---

Add the Plex built-in plugin. Implements `libraryAvailability@v1`,
`playback@v1`, `playbackSessions@v1`, `continueWatching@v1`, `watchHistory@v1`,
`libraryAdmin@v1`, and a user-scoped `idResolve@v1` against a user's own Plex
Media Server. Auth is the PIN flow (`oauth_device`), exchanged against
`plex.tv/api/v2/pins`; the approved token drives every subsequent call.
Connections carry an external URL (used for player / web deep links built by
the caller's device) and an optional internal URL marked `x-private` (used by
the host for server-to-server fetches). Session output is filtered to the
connecting account so a token that technically sees other users' sessions
never leaks them back. Extends `AuthResult.completed` with an optional
`userConfigPatch` so plugins that resolve server-side identifiers during auth
(Plex `machineIdentifier` + account id, Jellyfin `userId`) can write them
through without a client round-trip.

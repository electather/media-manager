---
"@ent-mcp/server": minor
---

Add the Plex built-in plugin. Implements `libraryAvailability@v1`,
`playback@v1`, `playbackSessions@v1`, `continueWatching@v1`, `watchHistory@v1`,
`libraryAdmin@v1`, and a user-scoped `idResolve@v1` against a user's own Plex
Media Server. Auth is the PIN flow (`oauth_device`), exchanged against
`plex.tv/api/v2/pins`; the approved token drives every subsequent call.
`pollAuth` now also auto-fills `externalServerUrl` from the first public
server connection in the `/resources` response so users do not have to
hand-copy the URL after the PIN completes. Connections carry an external URL
(used for player / web deep links built by the caller's device) and an
optional internal URL marked `x-private` (used by the host for server-to-server
fetches). Session output is filtered to the connecting account so a token
that technically sees other users' sessions never leaks them back. Rate-limit
handling is unified: a single `throwIfRateLimited` helper signals the
shared-credentials pool via `ctx.pool.markExhausted` on 429 for every call
site, including the direct-fetch scrobble / unscrobble / refresh paths.
`searchLibrary` now respects the caller's `limit` via `X-Plex-Container-Size`
and `getHistory` builds the `viewedAt>=<unix>` filter manually so
URLSearchParams does not percent-encode `>` and drop the `since` bound.
Extends `AuthResult.completed` with an optional `userConfigPatch` so plugins
that resolve server-side identifiers during auth (Plex `machineIdentifier` +
account id, Jellyfin `userId`) can write them through without a client
round-trip.

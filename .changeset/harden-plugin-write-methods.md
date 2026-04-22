---
"@ent-mcp/server": patch
---

Harden built-in plugin write methods after PR review.

- Seerr `createRequest` and `cancelRequest` now re-throw host-actionable errors (`plugin.token_expired`, `plugin.bad_credentials`, `plugin.rate_limited`) instead of absorbing them into a graceful `{ ok: false, message }` contract, so the host can trigger token refresh and backoff during writes.
- Trakt `getHistory`, `getTrending`, and `getPositions` skip rows missing the expected nested media object instead of throwing through a non-null assertion, matching the defensive pattern already in `getAnticipated`.
- Trakt `parseTraktId` now rejects prefix-matched digits such as `"42abc"`; only pure-digit strings are accepted.

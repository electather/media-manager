---
"@ent-mcp/server": patch
---

Added per-user rate limiting to the artwork RPC endpoint to prevent shared TMDB quota exhaustion. Throttled responses return HTTP 429 with a `Retry-After` header, and the limiter charges tokens per unique canonical lookup so batched requests cost what they actually cost downstream.

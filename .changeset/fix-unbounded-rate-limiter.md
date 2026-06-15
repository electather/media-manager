---
"@nama/server": patch
---

Fixed unbounded memory growth in the request rate limiter, whose key table now evicts idle, fully-refilled buckets instead of keeping an entry per client forever.

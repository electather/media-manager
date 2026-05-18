---
"@ent-mcp/server": patch
---

Fixed a race condition in job history pruning by atomising pruneSuccessfulRuns.

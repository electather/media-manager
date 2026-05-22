---
"@ent-mcp/server": patch
---

Fixed a prototype pollution vulnerability in the `primary_with_enrichment` media dispatch strategy: plugin responses carrying an own `__proto__`, `constructor`, or `prototype` key are now filtered before they reach the recursive merge, so a malicious enrichment payload cannot pollute the worker's `Object.prototype`.

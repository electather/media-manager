---
"@nama/server": patch
---

Capped per-request sourcemap bundle fan-out at 20 files and enlarged the parsed-map LRU cache to prevent attacker-influenced stacks from amplifying database reads.

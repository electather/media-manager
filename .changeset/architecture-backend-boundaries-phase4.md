---
---

Split drizzle schema files into per-module subdirectories under `apps/server/src/db/schema/`. Module ownership is now enforced structurally by fallow zones instead of the `@owner:` convention plus a hand-rolled ownership script.

---
"@nama/client": patch
---

Bounded the `rid` and `pid` diagnostics search parameters to 128 characters to prevent unnecessary round trips on crafted URLs.

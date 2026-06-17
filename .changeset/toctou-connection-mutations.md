---
"@nama/server": patch
---

Fixed `setDefault` to surface a not-found error when the connection is deleted between the pre-check and the default-promotion transaction, instead of silently clearing the existing default and leaving the plugin with none.

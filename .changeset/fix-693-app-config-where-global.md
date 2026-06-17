---
"@nama/server": patch
---

Fixed `getAppConfig` and `getNotificationRetention` to always read the `global` row from `app_config`, guarding against a rogue second row returning wrong retention values.

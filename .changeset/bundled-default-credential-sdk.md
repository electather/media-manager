---
"@nama/plugin-sdk": minor
---

Plugin manifests that declare `defaultSharedCredentials` without `sharedCredentialsSchema` now fail validation at load time instead of silently passing.

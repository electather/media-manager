---
"@nama/client": patch
---

Fixed the OAuth error banner persisting in bookmarked or shared login URLs by removing the ?error param from the URL immediately after it is read.

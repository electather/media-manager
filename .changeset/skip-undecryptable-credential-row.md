---
"@nama/server": patch
---

Fixed a bug where a single undecryptable admin credential row would abort the entire plugin credential pool; corrupted rows are now skipped with a warning.

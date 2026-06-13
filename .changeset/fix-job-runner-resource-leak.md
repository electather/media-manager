---
"@nama/server": patch
---

Fixed a resource leak in the job runner that permanently locked a job key when getConfig or startRun threw, preventing future runs without a process restart.

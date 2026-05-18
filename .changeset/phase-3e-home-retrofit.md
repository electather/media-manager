---
"@ent-mcp/server": minor
---

Restructured the home module to the canonical flat-with-reserved-files layout. The public barrel now exports `HOME_EVENTS` and `HomeServiceError`; the temporary `registerHomeLayoutWarmJob` job-function export was removed in favour of the standard `registerJobs` entry point. Behaviour is unchanged.

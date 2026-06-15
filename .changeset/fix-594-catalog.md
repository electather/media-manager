---
"@nama/server": patch
---

Fixed metadata refresh logging to report not-found and failed results as separate counts, and capped user history and rating mirror blobs at 10,000 events to prevent unbounded storage growth.

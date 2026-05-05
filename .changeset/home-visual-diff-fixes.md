---
"@ent-mcp/client": patch
---

Tighten home page visual fidelity to the nama-prototype reference: split hero clear-logo from the suggestion headline (logo becomes a small mono kicker, the show title becomes the H1), expose `Resume` + progress bar when the hero has watch progress, surface the brand wordmark next to the logo in the top nav (now driven by `home_nav_brand_label`), and add per-row `headerKey`/`subtitleKey` overrides on `RowData` so the second `continueWatching`, `recommendedForYou-tv`, and `recommendedForYou-movies` rows read as "Next in your shows", "TV shows to request", and "Movies to request".

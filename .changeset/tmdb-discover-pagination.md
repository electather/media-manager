---
"@nama/plugin-tmdb": patch
---

Fixed discover requests only ever returning TMDB's first page of results, so requesting more results than fit on one page now paginates instead of silently truncating.

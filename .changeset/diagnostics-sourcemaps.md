---
"@nama/server": minor
"@nama/client": minor
---

Added hidden sourcemap support to the diagnostics pipeline: the client build emits hidden maps and keeps them out of the public asset directory, and the server accepts map uploads and resolves minified stack frames to original source positions. Maps for superseded builds are pruned automatically so storage stays bounded.

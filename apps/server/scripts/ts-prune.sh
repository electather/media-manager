#!/usr/bin/env bash
# Finds exported symbols in apps/server that are never imported anywhere else
# in the project. Exits 0 when nothing is found; non-zero otherwise.
#
# Known limitation: ts-prune does not resolve bare directory imports
# (e.g. `import { X } from "../../artwork"` → artwork/index.ts). Barrel
# index files are therefore excluded from the results — only direct module
# files produce actionable signal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# Exclude:
#   "(used in module)" — exported and consumed within the same file
#   /index.ts:         — barrel files (directory-import limitation above)
#   src/api/router.ts  — package public API, consumed by @ent-mcp/client
IGNORE='(used in module)|/index\.ts:|src/api/router\.ts'

results=$(bunx ts-prune --project apps/server/tsconfig.json | grep -Ev "$IGNORE" || true)

if [[ -z "$results" ]]; then
  echo "No unused exports found."
  exit 0
fi

echo "$results"
exit 1

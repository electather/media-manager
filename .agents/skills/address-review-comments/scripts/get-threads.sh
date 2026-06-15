#!/usr/bin/env bash
# Usage: get-threads.sh <PR_NUM>
# Outputs unresolved thread node IDs paired with every comment ID in that thread.
# Each thread emits one line per comment so any comment ID resolves back to its thread.
# Note: GitHub hard-limits reviewThreads to first:100; warns to stderr when capped.
set -euo pipefail
[[ $# -lt 1 ]] && { echo "Usage: get-threads.sh <PR_NUM>" >&2; exit 1; }

PR=$1
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=$(cut -d/ -f1 <<< "$REPO")
NAME=$(cut -d/ -f2 <<< "$REPO")

JSON=$(gh api graphql \
  -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:100){nodes{databaseId}}}}}}}' \
  -f o="$OWNER" -f r="$NAME" -F n="$PR")

echo "$JSON" | jq -r 'if (.data.repository.pullRequest.reviewThreads.nodes | length) >= 100 then "WARNING: result capped at 100 threads — some may be missing" else empty end' >&2

echo "$JSON" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | . as $t | $t.comments.nodes[] | "thread=\($t.id) comment_id=\(.databaseId)"'

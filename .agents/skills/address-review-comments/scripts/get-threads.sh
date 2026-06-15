#!/usr/bin/env bash
# Usage: get-threads.sh <PR_NUM>
# Outputs thread node IDs paired with first-comment database IDs for resolution matching.
set -euo pipefail

PR=$1
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=$(cut -d/ -f1 <<< "$REPO")
NAME=$(cut -d/ -f2 <<< "$REPO")

gh api graphql \
  -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}' \
  -f o="$OWNER" -f r="$NAME" -F n="$PR" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | "thread=\(.id) comment_id=\(.comments.nodes[0].databaseId)"'

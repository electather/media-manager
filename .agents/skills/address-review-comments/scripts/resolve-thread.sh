#!/usr/bin/env bash
# Usage: resolve-thread.sh <THREAD_NODE_ID>
# Marks a review thread as resolved via GraphQL.
set -euo pipefail
[[ $# -lt 1 ]] && { echo "Usage: resolve-thread.sh <THREAD_NODE_ID>" >&2; exit 1; }

THREAD_ID=$1

gh api graphql \
  -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' \
  -f id="$THREAD_ID" \
  --jq '"resolved: \(.data.resolveReviewThread.thread.isResolved)"'

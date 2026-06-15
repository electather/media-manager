#!/usr/bin/env bash
# Usage: review-summary.sh <PR_NUM>
# Outputs reviewer verdicts and unresolved thread count only.
# Note: GitHub hard-limits reviewThreads to first:100; warns to stderr when capped.
set -euo pipefail
[[ $# -lt 1 ]] && { echo "Usage: review-summary.sh <PR_NUM>" >&2; exit 1; }

PR=$1
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=$(cut -d/ -f1 <<< "$REPO")
NAME=$(cut -d/ -f2 <<< "$REPO")

gh pr view "$PR" --json reviews \
  --jq '.reviews | group_by(.author.login) | .[] | last | "\(.author.login): \(.state)"'

JSON=$(gh api graphql \
  -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}' \
  -f o="$OWNER" -f r="$NAME" -F n="$PR")

echo "$JSON" | jq -r 'if (.data.repository.pullRequest.reviewThreads.nodes | length) >= 100 then "WARNING: result capped at 100 threads — some may be missing" else empty end' >&2

echo "$JSON" | jq -r '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length | "unresolved_threads: \(.)"'

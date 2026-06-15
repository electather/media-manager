#!/usr/bin/env bash
# Usage: reply-to-comment.sh <PR_NUM> <COMMENT_ID> <BODY>
# Posts an inline reply to a review comment thread.
set -euo pipefail

PR=$1
COMMENT_ID=$2
BODY=$3
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

gh api -X POST "repos/$REPO/pulls/$PR/comments/$COMMENT_ID/replies" \
  -f body="$BODY" \
  --jq '"replied: \(.id)"'

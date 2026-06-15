#!/usr/bin/env bash
# Usage: reply-to-comment.sh <PR_NUM> <COMMENT_ID>
# Reads reply body from stdin to handle spaces and newlines safely.
# Example: echo "Fixed in abc1234 at file.ts:42" | reply-to-comment.sh 663 12345
set -euo pipefail
[[ $# -lt 2 ]] && { echo "Usage: reply-to-comment.sh <PR_NUM> <COMMENT_ID>" >&2; exit 1; }

PR=$1
COMMENT_ID=$2
BODY=$(cat)
[[ -z "$BODY" ]] && { echo "Error: reply body is empty — pipe body via stdin" >&2; exit 1; }
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

gh api -X POST "repos/$REPO/pulls/$PR/comments/$COMMENT_ID/replies" \
  -f body="$BODY" \
  --jq '"replied: \(.id)"'

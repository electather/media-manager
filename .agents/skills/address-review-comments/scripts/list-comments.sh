#!/usr/bin/env bash
# Usage: list-comments.sh <PR_NUM>
# Outputs unresolved inline threads, review-level comments, and issue-level PR comments.
# Resolved threads are excluded automatically.
set -euo pipefail
[[ $# -lt 1 ]] && { echo "Usage: list-comments.sh <PR_NUM>" >&2; exit 1; }

PR=$1
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=$(cut -d/ -f1 <<< "$REPO")
NAME=$(cut -d/ -f2 <<< "$REPO")

echo "=== INLINE (unresolved only) ==="
gh api graphql \
  -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:100){nodes{databaseId path line originalLine author{login}body}}}}}}}' \
  -f o="$OWNER" -f r="$NAME" -F n="$PR" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | .comments.nodes[] | ["id=\(.databaseId) file=\(.path) line=\(.line // .originalLine) author=\(.author.login)", .body, "---"] | join("\n")'

echo "=== REVIEWS ==="
gh api "repos/$REPO/pulls/$PR/reviews" --paginate \
  --jq '.[] | select(.body != "") | "id=\(.id) author=\(.user.login) state=\(.state)\n\(.body)\n---"'

echo "=== ISSUE COMMENTS ==="
gh api "repos/$REPO/issues/$PR/comments" --paginate \
  --jq '.[] | "id=\(.id) author=\(.user.login)\n\(.body)\n---"'

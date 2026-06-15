#!/usr/bin/env bash
# Usage: list-comments.sh <PR_NUM>
# Outputs inline and review-level comments with IDs needed for replies and resolution.
set -euo pipefail

PR=$1
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

echo "=== INLINE ==="
gh api "repos/$REPO/pulls/$PR/comments" --paginate \
  --jq '.[] | "id=\(.id) file=\(.path) line=\(.line // .original_line) author=\(.user.login)\n\(.body)\n---"'

echo "=== REVIEWS ==="
gh api "repos/$REPO/pulls/$PR/reviews" --paginate \
  --jq '.[] | select(.body != "") | "id=\(.id) author=\(.user.login) state=\(.state)\n\(.body)\n---"'

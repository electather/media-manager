---
name: address-review-comments
description: Read reviewer comments on a PR, verify each one against the actual code, then either fix valid issues or push back on incorrect ones with evidence. Treat reviewer claims as hypotheses to verify, not facts to act on — reviewers are often right but not always. Use when the user says "address review comments", "handle this review", "respond to the reviewer", "apply PR feedback", "look at the review", or points to a specific review comment to act on.
---

# Address review comments carefully

Reviewers catch real issues — and sometimes they are wrong, working from an older version, or missing context. Treat every comment as a hypothesis: verify against the current code, then either fix or push back with evidence. Never blindly apply suggestions.

## Scripts

Use the scripts in `scripts/` — they output only what you need. Prefer them over raw `gh api` calls.

| Script | Usage |
|--------|-------|
| `review-summary.sh <PR>` | Reviewer verdicts + unresolved thread count. Run first. |
| `list-comments.sh <PR>` | All inline and review-level comments with IDs. |
| `reply-to-comment.sh <PR> <comment_id> <body>` | Post inline reply. |
| `get-threads.sh <PR>` | Unresolved thread node IDs paired with comment IDs. |
| `resolve-thread.sh <thread_node_id>` | Mark thread resolved. |

## 0. Set up an isolated worktree and sync with `origin/main`

Always work in a fresh worktree branched from `origin/main` so the current checkout stays untouched and the PR branch is verified against the latest base.

1. `git fetch origin main` to refresh the remote ref.
2. Identify the PR branch (e.g. `gh pr view <num> --json headRefName -q .headRefName`).
3. Create a worktree off `origin/main` and check out the PR branch inside it:
   ```bash
   git worktree add ../<repo>-pr-<num> origin/main
   cd ../<repo>-pr-<num>
   git fetch origin <pr-branch>
   git checkout <pr-branch>
   ```
4. Bring the PR branch up to date with `origin/main` before doing anything else:
   - Prefer `git merge origin/main` (or `git rebase origin/main` if the project convention is rebase — check existing PR history).
   - If conflicts arise, resolve them now. Re-run the project's checks/tests after resolution. Do not proceed to addressing comments until the branch merges cleanly.
   - Push the updated branch (`git push` — use `--force-with-lease` only if you rebased and the project allows it).
5. Clean up the worktree at the end with `git worktree remove <path>` once the loop terminates.

## 1. Gather the comments

- If the user named a PR, run `scripts/review-summary.sh <num>` for a quick overview, then `scripts/list-comments.sh <num>` for the full comment list with IDs. Resolved threads are excluded automatically — only act on what's listed.
- If no PR was named, infer from the current branch: `gh pr view --json number,url`. Confirm with the user if ambiguous.
- List the distinct concerns so you can address them one by one. Don't batch-respond blindly — each concern needs its own verification.

## 2. For each comment: verify before acting

Do this before changing code or replying:

1. **Read the cited code in its current state** — open the file now, don't rely on the diff snippet. The reviewer may be working from an older commit.
2. **Restate what the reviewer is claiming** in your own words: bug, style, perf, API misuse, missing test, naming, convention, etc.
3. **Check the claim against reality**:
   - "This will break when X" → trace the code path, or write a test that exercises X.
   - "There's a simpler way" → try it; confirm it actually is simpler and behaves identically.
   - "This violates our convention" → grep the codebase for that convention; don't assume it exists.
   - "We already have a helper for this" → find it. If you can't find it, say so.
   - "This isn't tested" → check the test files; maybe it is.
4. **Classify**: valid / partially valid / invalid / unsure.
5. **Out-of-scope finding.** If during verification you discover a real issue unrelated to this PR (different file, different feature, not caused by this change): create a GH issue (`gh issue create --title "<short title>" --body "<description with file:line context>"`), note the issue number in your reply, and move on. Do not fix it here.

Do not skip verification because the reviewer is senior, confident, or has been right before. One wrong fix on a public branch costs more than a minute of checking.

## 3. If valid → fix

- Make the **minimum change** that addresses the concern. No drive-by refactors.
- Add or update a test if the comment was about behavior.
- After fixing, reply on the thread: what changed and where (commit SHA, or `file.ts:42`).
- For inline threads: `scripts/reply-to-comment.sh <num> <comment_id> "<body>"`.
- For issue-level comments: `gh pr comment <num> --body "<body>"`.
- **Mark the inline thread resolved** once the fix is pushed:
  1. `scripts/get-threads.sh <num>` — find the `thread=` ID matching the `comment_id`.
  2. `scripts/resolve-thread.sh <thread_node_id>`.
  - Only resolve threads where you applied the fix — leave pushback threads for the reviewer.

## 4. If invalid or partially valid → push back

- Reply on the thread directly — don't silently resolve it.
- Be specific and evidence-based:
  - Point to the code or test that contradicts the claim (`file.ts:42`).
  - Quote the relevant spec, doc, or prior decision.
  - If the reviewer was working from an older version, say so and link to the current code.
- Stay polite and curious. "I checked X and it's handled at `file.ts:42` — am I missing something?" beats "you're wrong."
- For partially valid: do the valid part, and explain in the reply why the rest doesn't apply.
- Do not resolve the thread yourself — leave that for the reviewer.

## 5. If unsure → ask the user first

- If you cannot confidently determine whether the comment is valid after investigating, surface it to the user **before** replying on the PR. Include:
  - The comment (quoted).
  - What you investigated and found.
  - The specific ambiguity.
- Do not guess on a public thread — guessing either way damages trust with the reviewer.

## 6. Commit, push, wrap up

- Group fixes into focused commits with imperative-mood messages. Reference the thread if useful (`fix: null-check user in summary — addresses review`).
- If fixes change user-visible behavior, update the changeset.
- **Run fallow** before pushing. For each flag:
  - Valid (dead code, boundary violation, real issue) → fix it in this PR.
  - Invalid (false positive, intentional pattern) → add an inline ignore with a one-line reason:
    ```ts
    // fallow-ignore-next-line <rule> — <reason why this is not a real issue>
    ```
  - Never add to `.fallow/dead-code-baseline.json`. Baseline entries are permanent noise; inline ignores are self-documenting.
- Run the project's checks/tests before pushing (`vp check && vp test`, `make lint test`, etc. — check `CLAUDE.md`).
- Push. Resolve threads you fully addressed with a fix (see §3). Leave pushback threads unresolved — the reviewer resolves those.
- When everything is handled, request a re-review: `gh pr edit <num> --add-reviewer <handle>` or via the GitHub UI prompt.

## 7. Wait, recheck, loop

After pushing the round of fixes:

1. Sleep for **4 minutes** to give reviewers and CI time to catch up (`sleep 240`, or schedule a wakeup if the harness supports it).
2. Re-run §1 to fetch fresh comments and reviews. Compare against the set you already handled — only new or updated threads matter.
3. If new comments exist, repeat §0–§6 (re-sync with `origin/main` first; conflicts may have appeared while you waited).
4. Exit the loop when one of:
   - No new comments after the wait and CI is green.
   - The user explicitly stops the loop.
   - You hit an unsure case from §5 — surface to the user before continuing.
5. **Loop cap — 2 iterations.** After 2 complete iterations, if unresolved threads remain:
   - **Non-breaking threads** (nits, naming, style, docs, suggestions): for each, create a GH issue (`gh issue create --title "<short title>" --body "Raised in PR #<num>: <comment_body>"`) and resolve the thread (`scripts/resolve-thread.sh`). Reply on the thread with the issue link.
   - **Breaking threads** (correctness, security, behaviour change, API): do not convert to issues — surface to the user and block merge.
   - Once all non-breaking threads are converted and resolved, proceed to §8 if the PR is marked mergeable (`gh pr view <num> --json mergeable -q .mergeable` returns `MERGEABLE`).

Always re-sync with `origin/main` at the start of each loop iteration — base may have advanced.

## 8. Auto-merge (only when the user explicitly asks)

If — and only if — the user told you they want auto-merge for this PR, you may merge once **all** of the following hold:

- Every outstanding reviewer comment is **trivial** (nits, wording, formatting, doc tweaks, suggestion-only). Anything substantive (correctness, security, API, perf, behavior change) disqualifies — go back to §2.
- All required CI checks are green: `gh pr checks <num>` shows no failing or pending required checks.
- The PR is up to date with `origin/main` (you just synced in §0 / loop iteration).
- The PR is in a mergeable state: `gh pr view <num> --json mergeable,mergeStateStatus` reports `MERGEABLE` / `CLEAN`.

When all conditions hold, merge with the project's preferred strategy (check existing PRs; typically `gh pr merge <num> --squash --delete-branch` or `--merge`). If any condition fails, do **not** merge — report which condition blocked it and continue the loop.

Never auto-merge without an explicit user ask, even if the PR looks ready.

## Common pitfalls to avoid

- Blindly applying every suggestion. Reviewers are fallible.
- Silent scope expansion ("while I was here I also…"). Keep each fix narrow.
- Resolving your own pushback threads. Let the reviewer do that.
- Replying "fixed" without saying what you changed or where. Always cite a commit or line.
- Arguing without evidence. Always quote code, tests, or docs.
- Treating a polite suggestion as an order, or a firm claim as optional. Read tone, but verify either way.

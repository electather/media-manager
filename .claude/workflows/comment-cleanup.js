export const meta = {
  name: 'comment-cleanup',
  description: 'Summarize the 100 longest comments to <=3 lines of non-obvious info, then open one PR',
  phases: [
    { title: 'Scan', detail: 'Find the 100 longest comments via tools/find-long-comments.ts' },
    { title: 'Summarize', detail: '10 haiku agents rewrite comments in place (disjoint files, no conflicts)' },
    { title: 'PR', detail: 'Format, changeset, commit, open PR' },
  ],
}

// args: { limit?: number, agents?: number }
const LIMIT = (args && args.limit) || 100
const NUM_AGENTS = (args && args.agents) || 10

const COMMENTS_SCHEMA = {
  type: 'object',
  properties: {
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_line: { type: 'number' },
          end_line: { type: 'number' },
          file_address: { type: 'string' },
        },
        required: ['start_line', 'end_line', 'file_address'],
      },
    },
  },
  required: ['comments'],
}

const EDIT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    rewritten: { type: 'number' },
    skipped: { type: 'number' },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['rewritten', 'skipped', 'files'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: {
    pr_url: { type: 'string' },
    branch: { type: 'string' },
    files_changed: { type: 'number' },
    check_passed: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['pr_url', 'branch', 'files_changed'],
}

// --- Phase 1: Scan -------------------------------------------------------
phase('Scan')
const scan = await agent(
  `Run this exact command from the repo root and return its output parsed as structured data:

    bun tools/find-long-comments.ts --limit ${LIMIT}

The command prints a JSON array of objects: { "start_line", "end_line", "file_address" }.
Return EVERY object exactly as printed — do not invent, drop, reorder, or alter any value.
Run nothing else and edit nothing.`,
  { schema: COMMENTS_SCHEMA, phase: 'Scan', model: 'claude-sonnet-4-6' }
)

const comments = (scan && scan.comments) || []
if (comments.length === 0) {
  log('No long comments found — nothing to clean up.')
  return { done: true, rewritten: 0, pr_url: null }
}
log(`Scanned ${comments.length} long comments.`)

// --- Group by file, then distribute whole files across buckets -----------
// Each file is owned by exactly one bucket so the 10 edit agents never touch
// the same file in parallel — disjoint writes, no worktree isolation needed.
const byFile = new Map()
for (const c of comments) {
  if (!byFile.has(c.file_address)) byFile.set(c.file_address, [])
  byFile.get(c.file_address).push({ start_line: c.start_line, end_line: c.end_line })
}
const fileGroups = [...byFile.entries()].map(([file, regions]) => ({ file, regions }))
// Greedy least-loaded packing, biggest groups first, to balance comment counts.
fileGroups.sort((a, b) => b.regions.length - a.regions.length)
const bucketCount = Math.min(NUM_AGENTS, fileGroups.length)
const buckets = Array.from({ length: bucketCount }, () => ({ load: 0, groups: [] }))
for (const g of fileGroups) {
  const target = buckets.reduce((min, b) => (b.load < min.load ? b : min), buckets[0])
  target.groups.push(g)
  target.load += g.regions.length
}
log(`${byFile.size} files across ${bucketCount} agents (loads: ${buckets.map((b) => b.load).join(', ')}).`)

// --- Phase 2: Summarize --------------------------------------------------
phase('Summarize')
const editResults = await parallel(
  buckets.map((bucket, idx) => () =>
    agent(
      `You are rewriting overly long source comments in a TypeScript codebase. You own these files
EXCLUSIVELY — no other agent touches them, so edit freely.

Files and the line ranges of the long comment(s) in each:
${bucket.groups
  .map((g) => `- ${g.file}: ${g.regions.map((r) => `lines ${r.start_line}-${r.end_line}`).join(', ')}`)
  .join('\n')}

For EACH listed comment:
1. Read the file and locate the long comment at (or immediately around) the given line range. It is
   either one block comment (/* ... */ or /** ... */) or a run of consecutive // lines.
2. Rewrite it to AT MOST 3 lines of content. Keep ONLY information that is NOT obvious from reading
   the code: edge cases, gotchas, business/domain requirements, invariants, non-obvious "why",
   external references (issue/ticket/spec links), and known limitations.
3. DELETE the obvious: restating what the next line of code plainly does, narration, decorative
   banners, redundant @param/@returns that just echo the signature and types.
4. Preserve the original comment delimiter style (keep /** */ if it was JSDoc, // if it was line
   comments) and the original indentation. Keep genuinely useful JSDoc tags; drop echo-only ones.
5. If a comment is already concise and every line carries non-obvious info, leave it unchanged and
   count it as skipped.

Rules:
- Use the Edit tool, matching the exact existing comment text (multi-line). Line numbers may shift as
  you edit, so match by content and process one file fully before the next — never trust stale line
  numbers across edits.
- NEVER change, move, or delete any code. Comments only.
- Do not touch files not listed above.

Return how many comments you rewrote vs skipped, and the list of files you modified.`,
      {
        schema: EDIT_RESULT_SCHEMA,
        label: `summarize:${idx + 1}`,
        phase: 'Summarize',
        model: 'claude-haiku-4-5-20251001',
      }
    )
  )
)

const ok = editResults.filter(Boolean)
const totalRewritten = ok.reduce((n, r) => n + (r.rewritten || 0), 0)
const totalSkipped = ok.reduce((n, r) => n + (r.skipped || 0), 0)
log(`Rewrote ${totalRewritten} comments, skipped ${totalSkipped}.`)

if (totalRewritten === 0) {
  log('No comments were rewritten — skipping PR.')
  return { done: true, rewritten: 0, skipped: totalSkipped, pr_url: null }
}

// --- Phase 3: PR ---------------------------------------------------------
phase('PR')
const pr = await agent(
  `All comment edits are already in the working tree (comment-only changes, no code touched).
Create one PR for them. Run these steps from the repo root:

1. Format and validate the edits:
     vp check
   Capture whether it passed. If it fails ONLY on files unrelated to comment edits, note it and
   continue; do not try to fix unrelated pre-existing failures.

2. Create a branch off the current HEAD:
     git checkout -b chore/comment-cleanup-$(date +%Y%m%d-%H%M%S)

3. Add a changeset for an internal-only change (comment cleanup ships nothing to end users) — write
   the file directly, EXACTLY this content including both '---' lines and nothing else:
     ---
     ---
   Path: .changeset/comment-cleanup-$(date +%Y%m%d-%H%M%S).md

4. Stage only tracked modifications plus the changeset:
     git add -u
     git add .changeset/comment-cleanup-*.md
   Do NOT add untracked files (e.g. tooling or workflow scripts).

5. Commit:
     git commit -m "chore: summarize long comments"
   Do not mention AI, Claude, or automated generation anywhere in the message.

6. Push and open the PR:
     git push -u origin HEAD
     gh pr create --title "chore: summarize long comments" --body "<body>"
   Body: state that this batch summarizes ~${totalRewritten} long comments down to <=3 lines of
   non-obvious info (edge cases, business requirements) and removes obvious narration. Mention it is
   the latest run of the repeatable comment-cleanup workflow. Plain end-user-neutral language; no AI
   attribution.

Return the PR URL, the branch name, how many files changed (git diff --name-only against the base),
and whether 'vp check' passed.`,
  { schema: PR_SCHEMA, phase: 'PR', model: 'claude-sonnet-4-6' }
)

return {
  done: true,
  rewritten: totalRewritten,
  skipped: totalSkipped,
  files_changed: pr && pr.files_changed,
  branch: pr && pr.branch,
  pr_url: pr && pr.pr_url,
  check_passed: pr && pr.check_passed,
}

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

// Security-critical files carry threat-model context that a small model can
// under-value — route them to Sonnet, the rest to Haiku. Splitting first keeps
// the two sets in separate buckets so a single sensitive file can't drag a whole
// mixed bucket onto the slower model.
const isSensitive = (f) =>
  /^\.deepsec\//.test(f) || /\/(auth|crypto|connections|plugin-runtime)\//.test(f) || /(permission|role)/i.test(f)

// Greedy least-loaded packing of whole files into `n` buckets (biggest first),
// so parallel agents never share a file. Returns buckets tagged with `model`.
function pack(groups, n, model) {
  if (groups.length === 0 || n <= 0) return []
  const sorted = [...groups].sort((a, b) => b.regions.length - a.regions.length)
  const buckets = Array.from({ length: Math.min(n, sorted.length) }, () => ({ load: 0, groups: [], model }))
  for (const g of sorted) {
    const target = buckets.reduce((min, b) => (b.load < min.load ? b : min), buckets[0])
    target.groups.push(g)
    target.load += g.regions.length
  }
  return buckets
}

const sensitiveGroups = fileGroups.filter((g) => isSensitive(g.file))
const normalGroups = fileGroups.filter((g) => !isSensitive(g.file))
// Allocate agents proportionally to group counts (at least 1 to any non-empty set).
const sensAgents = sensitiveGroups.length
  ? Math.max(1, Math.round((NUM_AGENTS * sensitiveGroups.length) / fileGroups.length))
  : 0
const normAgents = Math.max(normalGroups.length ? 1 : 0, NUM_AGENTS - sensAgents)
const buckets = [
  ...pack(sensitiveGroups, sensAgents, 'claude-sonnet-4-6'),
  ...pack(normalGroups, normAgents, 'claude-haiku-4-5-20251001'),
]
log(
  `${byFile.size} files across ${buckets.length} agents ` +
    `(${sensitiveGroups.length} sensitive → Sonnet, ${normalGroups.length} normal → Haiku; ` +
    `loads: ${buckets.map((b) => b.load).join(', ')}).`
)

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

Your goal is to make each comment SHORTER without losing anything a future maintainer could not
reconstruct from the code itself. Shrinking length is secondary to preserving knowledge.

For EACH listed comment:
1. Read the file and locate the long comment at (or immediately around) the given line range. It is
   either one block comment (/* ... */ or /** ... */) or a run of consecutive // lines.
2. Rewrite it to AT MOST 3 lines of content WHERE POSSIBLE. The 3-line limit is a target, not a hard
   cap: if preserving the items below needs a 4th or 5th line, keep the line — never delete
   load-bearing information to hit a line count.
3. ALWAYS PRESERVE (this is the whole point — these are exactly what gets wrongly stripped):
   - Design choices and rejected alternatives WITH their reason — "we tried X but it fails because
     Y", "uses A instead of B because B breaks on Z". This is what stops a future dev from undoing it.
   - Design-doc / spec references and anchors verbatim: section refs (e.g. "design §B3"), invariant
     names (e.g. "V.CL1", "V.WIRE1"), and issue/PR numbers (e.g. "#505").
   - The meaning of magic numbers / literals when those values are NOT named in the code (e.g.
     "80 section head + 48 meta strip + 40 margin"), and stepped progressions whose steps encode
     intent (e.g. "backs off 5s → 10s → 20s → cap 30s", not "5s→30s").
   - Specific marker / constant / field / config names that bridge the comment to a convention
     (e.g. \`x-plugin-resolved: true\`, \`SYSTEM_ADMIN_ROLE_NAME\`).
   - Canonical correct shapes / required call patterns (e.g. \`new Hono().use("*", requireSession)\`).
   - Exact failure modes, security consequences, and threat models (privilege escalation, spoofing,
     SSRF, etc.) — never soften "immediate privilege escalation" into "a problem".
   - Edge cases, gotchas, business/domain requirements, invariants, the non-obvious "why", and
     known limitations.
4. DELETE only the genuinely obvious: restating what the next line of code plainly does, narration,
   decorative banners, redundant @param/@returns that just echo the signature and types.
5. Preserve the original comment delimiter style (keep /** */ if it was JSDoc, // if it was line
   comments) and the original indentation. Keep genuinely useful JSDoc tags; drop echo-only ones.
6. If a comment is already concise and every line carries non-obvious info, leave it unchanged and
   count it as skipped. When unsure whether a detail is obvious, KEEP it.

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
        model: bucket.model,
      }
    )
  )
)

const ok = editResults.filter(Boolean)
const totalRewritten = ok.reduce((n, r) => n + (r.rewritten || 0), 0)
const totalSkipped = ok.reduce((n, r) => n + (r.skipped || 0), 0)
const editedFiles = [...new Set(ok.flatMap((r) => r.files || []))]
log(`Rewrote ${totalRewritten} comments, skipped ${totalSkipped} across ${editedFiles.length} files.`)

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

4. Stage ONLY the files the summarize agents edited, plus the changeset — never use \`git add -u\`
   or \`git add .\`, which would sweep in any unrelated tracked change sitting in the working tree.
   The edited files are exactly:
${editedFiles.map((f) => `     ${f}`).join('\n')}
   First run \`git diff --name-only\` and confirm the modified set is a subset of that list. If any
   OTHER file shows as modified, do NOT commit — abort and report the unexpected files instead.
   Then:
     git add ${editedFiles.map((f) => `'${f}'`).join(' ')}
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

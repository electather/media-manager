export const meta = {
  name: 'pr-reviewer-loop',
  description:
    'Discover open PRs (excluding #689), triage to pick model (sonnet/opus), run address-review-comments skill for up to 2 rounds, file issues for unresolved findings, squash-merge if gate passes. Processed in batches of 5.',
  phases: [
    { title: 'Discover' },
    { title: 'Process' },
  ],
}

const owner = 'electather'
const repo = 'nama'
const SLUG = `${owner}/${repo}`
const SKIP_PRS = [689]

const DISCOVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prs'],
  properties: {
    prs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'branch', 'base', 'additions', 'deletions', 'changedFiles', 'title'],
        properties: {
          number: { type: 'integer' },
          branch: { type: 'string' },
          base: { type: 'string' },
          additions: { type: 'integer' },
          deletions: { type: 'integer' },
          changedFiles: { type: 'integer' },
          title: { type: 'string' },
        },
      },
    },
  },
}

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'complexity', 'blockingFindings', 'rationale'],
  properties: {
    model: { enum: ['sonnet', 'opus'] },
    complexity: { enum: ['trivial', 'moderate', 'complex'] },
    blockingFindings: { type: 'integer' },
    rationale: { type: 'string' },
  },
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'status', 'merged', 'summary'],
  properties: {
    number: { type: 'integer' },
    status: { enum: ['merged', 'pushed-awaiting-ci', 'blocked-needs-human', 'no-changes-needed', 'error'] },
    merged: { type: 'boolean' },
    rounds: { type: 'integer' },
    addressed: { type: 'array', items: { type: 'string' } },
    pushedBack: { type: 'array', items: { type: 'string' } },
    unresolved: { type: 'array', items: { type: 'string' } },
    issuesCreated: { type: 'array', items: { type: 'string' } },
    ciStatus: { type: 'string' },
    mergeStateStatus: { type: 'string' },
    summary: { type: 'string' },
  },
}

function triagePrompt(pr) {
  return `Triage PR #${pr.number} in ${SLUG} to decide which model should address its reviewer comments.

PR: "${pr.title}"
Branch: ${pr.branch} -> ${pr.base}. Size: +${pr.additions}/-${pr.deletions} across ${pr.changedFiles} files.

Read the actual context:
- \`gh pr view ${pr.number} --json body,title\`
- \`gh pr view ${pr.number} --comments\`
- \`gh api repos/${SLUG}/pulls/${pr.number}/comments\`

Pick the model:
- **opus** — substantive blocking findings (correctness, security, perf, API misuse, behavior change), server-side modules (auth, plugin-runtime, catalog, media, artwork, library, watchlist, preferences, notifications), large/complex diffs (>= ~300 changed lines or >= 15 files), or anything needing real judgment.
- **sonnet** — small client-only cleanups, doc/naming/wording nits, trivial suggestion-only comments, or pure refactors with no behavior change.

Return {model, complexity, blockingFindings (count of substantive blocking items), rationale (one sentence)}.`
}

function processPrompt(pr, triage) {
  return `Process PR #${pr.number} ("${pr.title}") in ${SLUG} and merge it if eligible. You are running in a FRESH ISOLATED git worktree, so operate directly here.

OUTPUT DISCIPLINE (critical): your VERY LAST action MUST be the StructuredOutput tool call — budget for it and do not end silently.

Triage: model=${triage?.model ?? 'sonnet'}, complexity=${triage?.complexity ?? 'unknown'} (${triage?.rationale ?? 'n/a'}).

Read \`.agents/skills/address-review-comments/SKILL.md\` and apply it. Treat every reviewer claim as a HYPOTHESIS — fix valid ones, push back with evidence on invalid ones.

PR facts:
- Branch \`${pr.branch}\` -> base \`${pr.base}\`. Size +${pr.additions}/-${pr.deletions}, ${pr.changedFiles} files.
- Reviewer is an automated bot (\`github-actions\` / \`claude-review\` check). It will NOT come back to resolve threads.

Merge gate (verified branch protection on \`main\`):
- Required status check: \`ci\` must be \`pass\`. (\`fallow\` and \`claude-review\` are NOT required.)
- \`required_conversation_resolution\` is ON: every review thread must be resolved before merge.
- 0 required approvals. Merge method: SQUASH with --delete-branch.

SYNC FIRST:
0. \`git fetch origin\`, \`git checkout ${pr.branch}\`, then \`git merge origin/main\`. Resolve conflicts; do NOT continue on a dirty tree.

ROUND 1:
1. Gather ALL reviewer comments: \`gh pr view ${pr.number} --comments\`, \`gh api repos/${SLUG}/pulls/${pr.number}/comments\`, \`gh pr view ${pr.number} --json reviews\`.
2. For EACH finding: verify against CURRENT code (skill §2), then fix (valid) or push back with evidence (invalid). Unsure substantive points → carry to round 2.
3. If user-visible behavior changed, add/update \`.changeset/<slug>.md\` per CLAUDE.md.
4. Run \`vp install\` if needed, then \`vp check && vp test\`. Fix failures. NEVER proceed on red.
5. Commit (imperative mood, NO Claude attribution) and push. Resolve every thread you handled via GraphQL:
   \`gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<thread_node_id>\`
   Get thread node IDs via:
   \`gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}'  -f o=${owner} -f r=${repo} -F n=${pr.number}\`

ROUND 2:
6. Re-fetch threads (poll \`gh pr checks ${pr.number}\` a few times but don't block indefinitely). Address ONLY new/unresolved findings since round 1. Re-run \`vp check && vp test\`, commit, push, resolve threads. This is the LAST round.

FINALIZE:
7. FILE ISSUES for residue after round 2: for every finding still unresolved, open a tracking issue:
   \`gh issue create --repo ${SLUG} --title "<concise finding>" --body "<what reviewer flagged, file:line, why deferred, link to PR #${pr.number}>" --label "status: ready-for-review"\`
   Reply on the corresponding thread linking the issue, then resolve that thread. Record each URL under issuesCreated.
8. Check eligibility: \`gh pr view ${pr.number} --json mergeable,mergeStateStatus\` and \`gh pr checks ${pr.number}\`.
9. MERGE only if ALL hold: every finding is fixed/refuted/tracked; ALL threads resolved; required \`ci\` is \`pass\`; mergeStateStatus is CLEAN.
   Command: \`gh pr merge ${pr.number} --squash --delete-branch\`. Set status='merged', merged=true, rounds=<1 or 2>.
10. If \`ci\` is still pending after final push, do NOT wait indefinitely: set status='pushed-awaiting-ci', merged=false.
11. NEVER use admin/force bypass. If a gate fails, leave PR open and report which gate blocked.

Return: number, status, merged, rounds, addressed[], pushedBack[], unresolved[], issuesCreated[], ciStatus, mergeStateStatus, summary (2-3 sentences: what changed, what pushed back, what filed, why merged/not).`
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Phase 1: Discover open PRs dynamically
phase('Discover')
const discovered = await agent(
  `List all open (non-draft, non-merged) GitHub PRs in ${SLUG}, excluding PR numbers ${SKIP_PRS.join(', ')}.

Run: gh pr list --state open --json number,title,headRefName,baseRefName,isDraft,additions,deletions,changedFiles --limit 100

Filter out: draft PRs and PR numbers ${SKIP_PRS.join(', ')}.

For each PR return: number (int), branch (headRefName), base (baseRefName), additions (int), deletions (int), changedFiles (int), title.
If no PRs match, return an empty prs array.`,
  { label: 'discover', phase: 'Discover', model: 'claude-haiku-4-5-20251001', schema: DISCOVER_SCHEMA }
)

const prs = discovered ? discovered.prs : []

if (prs.length === 0) {
  log('No open PRs found. Nothing to process.')
} else {
  log(`Found ${prs.length} open PRs: ${prs.map((p) => '#' + p.number).join(', ')}`)
  const batches = chunk(prs, 5)
  const all = []

  for (let b = 0; b < batches.length; b++) {
    const batchLabel = `Batch ${b + 1}/${batches.length}`
    phase('Process')
    log(`${batchLabel}: ${batches[b].map((p) => '#' + p.number).join(' ')}`)

    const batchResults = await parallel(
      batches[b].map((pr) => async () => {
        const triage = await agent(triagePrompt(pr), {
          label: `triage:#${pr.number}`,
          phase: 'Process',
          model: 'claude-haiku-4-5-20251001',
          schema: TRIAGE_SCHEMA,
        })
        const model = triage?.model === 'opus' ? 'opus' : 'sonnet'
        const res = await agent(processPrompt(pr, triage), {
          label: `pr:#${pr.number} [${model}]`,
          phase: 'Process',
          model,
          isolation: 'worktree',
          schema: RESULT_SCHEMA,
        })
        return { number: pr.number, title: pr.title, model, triage, result: res }
      }),
    )

    all.push(...batchResults.filter(Boolean))
    log(`${batchLabel} complete. Merged so far: ${all.filter((r) => r.result?.merged).length}`)
  }

  const merged = all.filter((r) => r.result?.status === 'merged')
  const awaiting = all.filter((r) => r.result?.status === 'pushed-awaiting-ci')
  const human = all.filter((r) => r.result?.status === 'blocked-needs-human')
  const errored = all.filter((r) => !r.result || r.result.status === 'error')
  const issuesFiled = all.flatMap((r) => r.result?.issuesCreated ?? [])

  log(
    `Done. merged=${merged.length} awaiting-ci=${awaiting.length} needs-human=${human.length} errored=${errored.length} issues-filed=${issuesFiled.length}`,
  )

  return {
    totals: {
      processed: all.length,
      merged: merged.length,
      awaitingCi: awaiting.length,
      needsHuman: human.length,
      errored: errored.length,
      issuesFiled: issuesFiled.length,
    },
    issuesFiled,
    byPr: all.map((r) => ({
      number: r.number,
      model: r.model,
      status: r.result?.status ?? 'error',
      merged: !!r.result?.merged,
      rounds: r.result?.rounds ?? null,
      issuesCreated: r.result?.issuesCreated ?? [],
      summary: r.result?.summary ?? '(no result)',
    })),
  }
}

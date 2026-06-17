---
name: label-issues
description: Apply correct GitHub labels to issues and PRs. Use when creating a new issue, opening a PR, or triaging unlabeled items. Covers all label groups: type, scope, priority, complexity, status, and meta.
---

# Label issues and PRs correctly

Every issue and PR must have at minimum one `type:` label and one `scope:` label. PRs also require a `complexity:` label. Priority is set on issues; status is updated as work progresses.

## How to apply labels

```bash
# Add labels (replace <number> with issue/PR number)
gh issue edit <number> --add-label "type: bug,scope: server,priority: high"
gh pr edit <number> --add-label "type: feature,scope: client,complexity: medium"
```

---

## Group: `type` — What kind of change is this?

Pick exactly one. Required on every issue and PR.

| Label | When to use |
|---|---|
| `type: bug` | Something is broken or behaving unexpectedly |
| `type: feature` | New capability or enhancement |
| `type: refactor` | Internal cleanup without behaviour change — no new functionality |
| `type: docs` | Documentation-only changes |
| `type: test` | Tests added or updated, no production code change |
| `type: chore` | Tooling, build, CI, or housekeeping |
| `type: performance` | Changes primarily aimed at improving speed or resource use |
| `type: security` | Security-related fixes or hardening |
| `type: breaking-change` | Add alongside another type label when the change breaks the public API |
| `type: epic` | Parent issue tracking multiple related child issues (issues only) |

---

## Group: `scope` — Which package is affected?

Pick one or more. Required on every issue and PR.

| Label | When to use |
|---|---|
| `scope: client` | Changes in `apps/client/` (`@nama/client`) |
| `scope: server` | Changes in `apps/server/` (`@nama/server`) |
| `scope: shared` | Changes in `packages/shared/` (`@nama/shared`) |
| `scope: ci` | CI workflows, release tooling, GitHub Actions |
| `scope: deps` | Dependency version bumps or package changes |

Apply multiple scope labels when a change genuinely spans packages (e.g. a shared type change + server consumer = `scope: shared` + `scope: server`).

---

## Group: `priority` — How urgently does this need attention?

Required on issues. Optional on PRs (inherit from linked issue).

| Label | When to use |
|---|---|
| `priority: critical` | Production broken, data loss risk, security vulnerability — fix now |
| `priority: high` | Significant user impact, schedule within current sprint |
| `priority: medium` | Normal priority — schedule in upcoming sprint |
| `priority: low` | Nice to have, no deadline pressure |

---

## Group: `complexity` — How much work is this?

Required on PRs and issues. Used to select the right LLM for the fix — low/medium → smaller model, high → larger model.

| Label | When to use |
|---|---|
| `complexity: low` | Single-file change, under 2 hours |
| `complexity: medium` | Multi-file change, 2–8 hours |
| `complexity: high` | Cross-cutting change, over 8 hours |

---

## Group: `status` — Where is this in the workflow?

Applied by maintainers as work progresses. Do not set on creation unless you know the state.

| Label | When to use |
|---|---|
| `status: needs-triage` | Newly opened, awaiting initial review |
| `status: needs-info` | Waiting on more information from the author |
| `status: needs-repro` | Bug report needs a reproducible example |
| `status: in-progress` | Actively being worked on |
| `status: blocked` | Cannot proceed — blocked by another issue or decision |
| `status: ready-for-review` | PR is complete and awaiting reviewer attention |

---

## Group: `meta` — Lifecycle and housekeeping

| Label | When to use |
|---|---|
| `duplicate` | This issue or PR already exists — link the original and close |
| `wontfix` | Will not be addressed — add a comment explaining why |
| `invalid` | Not a valid issue (misuse, not reproducible, off-topic) |
| `good first issue` | Suitable for new contributors — must have clear acceptance criteria |
| `help wanted` | Maintainers want community help on this |
| `question` | Asking for information, not reporting a bug or requesting a feature |
| `changeset: missing` | PR is missing a required `.changeset/` file — set by CI, remove when fixed |

---

## Minimum label set by artifact type

| Artifact | Required | Recommended |
|---|---|---|
| Issue (bug) | `type: bug` + `scope: *` + `complexity: *` | `priority: *`, `status: needs-triage` |
| Issue (feature) | `type: feature` + `scope: *` + `complexity: *` | `priority: *` |
| Issue (epic) | `type: epic` + `scope: *` + `complexity: *` | `priority: *` |
| PR | `type: *` + `scope: *` + `complexity: *` | `status: ready-for-review` |

---

## Decision guide

1. **Broken in prod?** → `type: bug` + `priority: critical`
2. **No prod code touched?** → `type: docs` or `type: test` or `type: chore`
3. **Touches `packages/shared/` AND a consumer?** → multiple `scope:` labels
4. **Single file, quick fix?** → `complexity: low` (Haiku-class model sufficient)
5. **Multi-file, a few hours?** → `complexity: medium` (Sonnet-class)
6. **Cross-cutting, full day+?** → `complexity: high` (Opus-class)
7. **Missing `.changeset/`?** → CI sets `changeset: missing`; create the file to clear it
8. **Closes another issue?** → do not copy labels; apply fresh based on the PR diff

<!--
  Thanks for contributing to media-manager!
  PR titles should follow Conventional Commits, e.g. `feat(client): add plugin list view`.
  Scopes in this repo: client, server, shared, ci, deps, docs.
-->

## Summary

<!-- What does this PR change, and why? One or two sentences is usually enough. -->

## Linked issue

<!-- e.g. "Closes #123" or "Relates to #456". Delete this section if not applicable. -->

## Design document

<!--
  Link the design document this PR implements or extends (e.g.
  `docs/2026-04-19-plugin-architecture-design.md`). Update that
  document in the same PR when the code changes its surface — code and
  doc must stay in sync on merge. Delete this section ONLY for pure
  internal refactors, test-only changes, CI/tooling, or doc-only PRs.
-->

## Type of change

<!-- Check all that apply. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behaviour)
- [ ] Refactor / internal cleanup (no behaviour change)
- [ ] Documentation
- [ ] CI / build / tooling

## Scope

<!-- Which workspace(s) does this touch? Check all that apply. -->

- [ ] `@ent-mcp/client`
- [ ] `@ent-mcp/server`
- [ ] `@ent-mcp/shared`
- [ ] Tooling / CI
- [ ] Docs

## Test plan

<!--
  Describe how you verified the change. Prefer reproducible commands.
  Examples:
    - `vp test apps/server`
    - Manual: start `vp run dev`, navigate to /plugins, add a connection, verify it persists after reload.
-->

- [ ] `vp check` passes locally
- [ ] `vp test` passes locally
- [ ] Manual verification steps listed above

## Screenshots / recordings

<!-- For UI changes, drop screenshots or a short clip here. Remove the section otherwise. -->

## Checklist

- [ ] PR title follows Conventional Commits
- [ ] Tests added or updated for new behaviour
- [ ] Docs updated (README, `docs/`, inline) where relevant
- [ ] A changeset is included, or `bunx changeset add --empty` was run for no-op changes
- [ ] No secrets, credentials, or personal data committed

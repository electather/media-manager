---
goal: Refactor command menu → extensible features/command-menu module + backend search + TanStack Hotkeys + inline settings drill
version: 1.0
date_created: 2026-05-08
last_updated: 2026-05-08
owner: Omid Astaraki
status: "Planned"
tags: [feature, refactor, client, server, shared, command-menu, hotkeys, search]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Promote `apps/client/src/app/command-menu/` → extensible feature module at `apps/client/src/features/command-menu/`. Wire real backend search via new `/api/search` endpoint. Replace custom keydown handler w/ `@tanstack/react-hotkeys`. Add inline settings drill (theme, locale) via generic `SettingItem<T>` registry contribution.

Spec: `docs/2026-05-08-command-menu-extensible-design.md`

Stack: React 19, cmdk, TanStack Router/Query, Hono, Paraglide, better-auth, Drizzle (server reads only), zod.

Pre-stable per `CLAUDE.md` → breaking changes acceptable. ⊥ shim, ⊥ deprecation chain.

7 phases. Each phase = 1 PR + 1 changeset. Order strict (later phases depend on earlier).

---

## 1. Requirements & Constraints

- **REQ-001**: Feature module lives at `apps/client/src/features/command-menu/`. Layout per spec §4. `app/command-menu.tsx` → 5-line mount. `app/command-menu-trigger.tsx` unchanged.
- **REQ-002**: Contribution registry per spec §5. Kinds: `page | action | search-mode | setting`. Add new contribution = 2 file edits (new file + 1 line in `registry/<kind>/index.ts`). ⊥ menu-internal change.
- **REQ-003**: All contribution `id` unique across all kinds. Validated by `registry/index.test.ts`.
- **REQ-004**: Sort key `(order ?? 100, id)` deterministic. Menu never sorts mutably.
- **REQ-005**: Drill-stack `frames: NavFrame[]`, root frame index 0 always present. Reducer `lib/nav-stack.ts`.
- **REQ-006**: Esc on non-root → pop. Esc on root → close. Backspace empty input + non-root → pop. Close → stack reset.
- **REQ-007**: New endpoint `GET /api/search?q=<string>&kind=tv|movie|all&limit=<int>`. Auth: same `/api/*` better-auth middleware. Anonymous → 401.
- **REQ-008**: zod schemas in `@ent-mcp/shared/search`. New subpath export. `q` 1–80, `kind` enum, `limit` 1–50 default 20.
- **REQ-009**: `compactMediaItemSchema` reused from `@ent-mcp/shared/home`. ⊥ duplicate.
- **REQ-010**: Server search aggregates via existing catalog-service. Returns `CompactMediaItem[]`. `hasMore = total > limit`. 400 invalid input. 500 upstream err logged via diagnostics service.
- **REQ-011**: Client `useSearchResults(rawQuery, scope)` — `useDeferredValue` + 200ms debounce, gated `q.trim().length >= 2`, `staleTime 30s`, `placeholderData: prev`.
- **REQ-012**: Pkg `@tanstack/react-hotkeys` added to `apps/client/dependencies`. Bundle delta noted in changeset.
- **REQ-013**: All hotkeys registered w/ `meta: { name, description }` so cheatsheet (`useHotkeyRegistrations`) stays complete.
- **REQ-014**: Custom `window.addEventListener("keydown", ...)` handler in `use-command-menu-shortcuts.ts` removed entirely. Replaced by `use-command-hotkeys.ts`.
- **REQ-015**: Page sequences: `g h` → `/`, `g l` → `/library`, `g w` → `/watchlist`, `g s` → `/settings`, `g c` → `/settings/connections`. Disabled when menu open (`enabled: !open` per registration).
- **REQ-016**: Theme + locale = `SettingItem` contributions. Drill-in via generic `setting-drill.tsx` (no per-setting UI).
- **REQ-017**: `useBoundSettings()` binds `read`/`write` at runtime via `useTheme()` / locale hooks. Registry holds defaults; runtime overrides via spread.
- **REQ-018**: `LOCALE_SETTING.write` uses `needsReload(next, current)` helper resolved in phase 6 (either `() => false` if hot-swap works or `(n, c) => n !== c` w/ 250ms `setTimeout(window.location.reload)`).
- **REQ-019**: Pre-stable. ⊥ deprecation shim. Imports updated atomic per phase.
- **REQ-020**: Each phase commit green: `vp check && vp test`. PR contains `.changeset/<slug>.md` per `CLAUDE.md`.
- **REQ-021**: Paraglide keys added in phase that consumes them. List per spec §8: `hotkey_*`, `command_menu_setting_*`, `theme_*_label`, `locale_<code>_label`.
- **SEC-001**: `/api/search` rate-limited via existing API middleware (no new limiter). zod validation rejects oversized `q`.
- **CON-001**: ⊥ new top-level client deps beyond `@tanstack/react-hotkeys`.
- **CON-002**: ⊥ files >300 LOC. Decompose per memory rule #17.
- **CON-003**: Shared pkg zero runtime deps beyond zod (catalog).
- **CON-004**: ⊥ plugin-pkg contributions v1. Registry closed to client pkgs.
- **CON-005**: Recents stay localStorage. ⊥ server-side recents v1.
- **GUD-001**: Imports direct from `@ent-mcp/shared/search` — no shim.
- **GUD-002**: Components ≤300 LOC, sub-folders 1 level deep max (memory rule #17).
- **PAT-001**: Static registry per kind: module-scope `as const` array, kind-keyed `index.ts` aggregator. Tree-shakeable.
- **PAT-002**: Drill-stack reducer pattern (push / pop / reset). Pure function.
- **PAT-003**: Feature folder layout per `frontend-feature-architecture` skill.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Server `/api/search` endpoint + `@ent-mcp/shared/search` schemas. ⊥ client wiring this phase.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `packages/shared/src/search/{schemas,types,index}.ts`. Define `searchQuerySchema` (q 1–80, kind enum, limit 1–50 default 20), `searchResponseSchema` (results: `compactMediaItemSchema[]`, hasMore: bool). Re-export from index. | | |
| TASK-002 | Add `"./search": "./src/search/index.ts"` to `packages/shared/package.json` exports. Update `tsconfig` paths if needed. | | |
| TASK-003 | Create `apps/server/src/routes/search.ts` Hono handler. Auth via existing `/api/*` middleware. Validate query via `searchQuerySchema`. | | |
| TASK-004 | Wire search to existing catalog-service aggregator. Map results → `CompactMediaItem[]`. Truncate to `limit`. Compute `hasMore`. | | |
| TASK-005 | Register route in `apps/server/src/routes/index.ts` (or equivalent root mount). | | |
| TASK-006 | Error handling: 400 zod parse fail (auto via Hono validator middleware), 500 upstream catalog err logged via diagnostics service `captureError`. | | |
| TASK-007 | Add integration test `apps/server/src/routes/__tests__/search.test.ts`: 200 OK shape, 400 bad kind, 400 q too long, 401 anonymous, scope filter applied, limit cap. | | |
| TASK-008 | Add `.changeset/<slug>.md` minor bump for `@ent-mcp/server`. End-user sentence: "Added search endpoint powering the command menu." | | |
| TASK-009 | Run `vp check && vp test`. Open PR. | | |

### Implementation Phase 2

- GOAL-002: Move existing client files `app/command-menu/*` → `features/command-menu/*`. Update imports. ⊥ behavior change.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Create `apps/client/src/features/command-menu/` w/ subdirs `registry/`, `hooks/`, `components/`, `lib/`, `registry/settings/`. | | |
| TASK-011 | Move `app/command-menu/command-menu.tsx` → `features/command-menu/components/command-menu.tsx`. Update relative imports. | | |
| TASK-012 | Move `app/command-menu/command-menu-data.ts` → split: `registry/pages.ts`, `registry/actions.ts`, `registry/search-modes.ts`. Re-export aggregate from `registry/index.ts`. | | |
| TASK-013 | Move `app/command-menu/types.ts` → `features/command-menu/types.ts`. | | |
| TASK-014 | Move `app/command-menu/use-command-menu-shortcuts.ts` → `features/command-menu/hooks/use-command-menu-shortcuts.ts` (renamed in phase 4). | | |
| TASK-015 | Move `app/command-menu/use-media-pool.ts` → `features/command-menu/hooks/use-media-pool.ts`. | | |
| TASK-016 | Move `app/command-menu/use-recent-items.ts` → `features/command-menu/hooks/use-recent-items.ts`. | | |
| TASK-017 | Move `app/command-menu/i18n.ts` → `features/command-menu/lib/i18n.ts`. | | |
| TASK-018 | Move match-value helpers from `command-menu.tsx` → `features/command-menu/lib/match-values.ts`. | | |
| TASK-019 | Fold `shared/components/command-menu-media-provider.tsx` → `features/command-menu/components/command-menu-media-provider.tsx`. Re-export from `features/command-menu/index.ts`. Delete old shared shim. | | |
| TASK-020 | Create `features/command-menu/index.ts` public API: `CommandMenu`, `CommandMenuMediaProvider`, types `CommandMenuMediaItem`, `CommandMenuMediaSource`. | | |
| TASK-021 | Replace `apps/client/src/app/command-menu/` w/ thin `apps/client/src/app/command-menu.tsx` mount file (5-line re-export). Delete old dir. | | |
| TASK-022 | Update import sites: `routes/_authenticated/_app/route.tsx` (provider mount), `app/app-shell.tsx`, `app/top-nav.tsx`, `app/command-menu-trigger.tsx`. | | |
| TASK-023 | Move tests `app/command-menu/__tests__/*` → `features/command-menu/**/__tests__/*` co-located w/ moved files. Update import paths. | | |
| TASK-024 | Add empty changeset (internal-only refactor): `---\n---\n` + empty body. | | |
| TASK-025 | Run `vp check && vp test`. Open PR. | | |

### Implementation Phase 3

- GOAL-003: Introduce `NavFrame` types + nav-stack reducer. Refactor menu to consume stack. Single-scope kept as `scope` frame. ⊥ visible behavior change.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Extend `features/command-menu/types.ts` w/ `NavFrame`, `ContributionKind`, `Base`, refined `PageItem`/`ActionItem`/`SearchModeItem`/`SettingItem`/`SettingOption`/`ActionContext` per spec §5. | | |
| TASK-027 | Create `features/command-menu/lib/nav-stack.ts`. Export `initial`, `reducer`, `NavState`, `NavAction`. Pure fn. Pop floor at root. | | |
| TASK-028 | Create unit test `lib/__tests__/nav-stack.test.ts`: push/pop/reset invariants, pop floor, frame ordering. | | |
| TASK-029 | Refactor `command-menu.tsx`: replace `useState<CommandScope>` w/ `useReducer(reducer, initial)`. Map current scope → `frame.kind === "scope"`. Backspace + Esc dispatch `{type: "pop"}`. | | |
| TASK-030 | Extract `command-search-header.tsx` from `command-menu.tsx`. Pass top frame for breadcrumb. Render `ScopeChip` only when top frame `kind === "scope"`. | | |
| TASK-031 | Move row helpers (`MediaRow`, `RowIcon`, `RowContent`, `RowAffordance`, `MediaThumb`) → `components/command-row.tsx` + `components/media-row.tsx`. | | |
| TASK-032 | `useSections` hook → `hooks/use-sections.ts`. Drives content from top frame. | | |
| TASK-033 | Test: `components/__tests__/command-menu.test.tsx` — verify scope drill via stack: select tv-search-mode → top frame `scope:tv` → backspace empty → root. | | |
| TASK-034 | Empty changeset (internal refactor). | | |
| TASK-035 | Run `vp check && vp test`. Open PR. | | |

### Implementation Phase 4

- GOAL-004: Replace custom keydown w/ `@tanstack/react-hotkeys`. Add page sequences. Cheatsheet sub-page via `useHotkeyRegistrations`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-036 | Add `@tanstack/react-hotkeys` to `apps/client/package.json` dependencies. Run `vp install`. Note bundle delta in changeset. | | |
| TASK-037 | Create `features/command-menu/hooks/use-command-hotkeys.ts`. Replaces `use-command-menu-shortcuts.ts`. | | |
| TASK-038 | Register globals via `useHotkey`: `Mod+K` toggle, `/` open (ignoreInputs), `Escape` closeOrPop (enabled when open, preventDefault: false). All w/ `meta`. | | |
| TASK-039 | Register page sequences via `useHotkeySequences`. Map `pages.filter(p => p.sequence)`. `enabled: !open` per registration. Default sequences per spec §8.2 (`g h`, `g l`, `g w`, `g s`, `g c`). Add `sequence` to corresponding `PageItem` definitions in `registry/pages.ts`. | | |
| TASK-040 | Register per-row contributions via `useHotkeys`: flatMap any contribution w/ `hotkey` set. `conflictBehavior: "warn"`. | | |
| TASK-041 | Render `<Kbd>` next to row label when contribution declares `hotkey`. Update `command-row.tsx`. | | |
| TASK-042 | Wire OPEN_EVENT (`nama:open-command`) listener inside `use-command-hotkeys.ts` to preserve top-nav button compat. | | |
| TASK-043 | Delete `use-command-menu-shortcuts.ts` + its test. | | |
| TASK-044 | Add new action `act:show-shortcuts` to `registry/actions.ts`. `run: ({ push }) => push({ kind: "cheatsheet" })`. | | |
| TASK-045 | Create `components/shortcuts-cheatsheet.tsx`. Reads `useHotkeyRegistrations()`. Group: Menu / Navigate / Actions by registration source. Each row: `<Kbd>` + `meta.name` + `meta.description`. | | |
| TASK-046 | Wire cheatsheet frame render in `command-menu.tsx` content switch. Backspace / Esc → pop. | | |
| TASK-047 | Add Paraglide messages: `hotkey_toggle_menu_name`, `hotkey_toggle_menu_desc`, `hotkey_open_menu_name`, `hotkey_open_menu_desc`, `command_menu_action_show_shortcuts_label`, `command_menu_action_show_shortcuts_hint`, `command_menu_section_shortcuts_menu`, `command_menu_section_shortcuts_navigate`, `command_menu_section_shortcuts_actions`. | | |
| TASK-048 | Tests: `hooks/__tests__/use-command-hotkeys.test.tsx` — Mod+K toggle, `/` open, Esc behavior, sequence triggers when closed only, sequence disabled when open. Use `userEvent.keyboard("{Meta>}k{/Meta}")`. | | |
| TASK-049 | Test: `components/__tests__/shortcuts-cheatsheet.test.tsx` — registrations grouped + rendered. | | |
| TASK-050 | Changeset minor `@ent-mcp/client`. End-user sentence: "Replaced custom shortcut handling with TanStack Hotkeys, added vim-style page jumps, and a shortcuts cheatsheet." | | |
| TASK-051 | Run `vp check && vp test`. Open PR. | | |

### Implementation Phase 5

- GOAL-005: Build generic `setting-drill.tsx`. Convert theme cycle action → `THEME_SETTING` contribution. Settings group rendered on root frame.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-052 | Create `features/command-menu/registry/settings/theme.ts`. Export `THEME_SETTING: SettingItem<"system"|"light"|"dark">` per spec §9.1. Default `read`/`write` stubs (overridden via runtime bind). `hotkey: "Mod+Shift+T"`. | | |
| TASK-053 | Create `features/command-menu/registry/settings/index.ts`. `export const COMMAND_SETTINGS = [THEME_SETTING] as const;`. | | |
| TASK-054 | Update `registry/index.ts` aggregator to include `COMMAND_SETTINGS` keyed by kind. | | |
| TASK-055 | Create `features/command-menu/hooks/use-bound-settings.ts`. Returns memoized array w/ `read`/`write` overridden via `useTheme()` (theme only this phase). | | |
| TASK-056 | Create `features/command-menu/components/setting-drill.tsx`. Generic over `SettingItem<T>`. Renders options w/ check on current. Selecting option → `setting.write(opt.id)` → toast (if `toastKey`) → `onPop()`. | | |
| TASK-057 | Add `lib/match-values.ts` helper `settingMatchValue(setting, opt)`. | | |
| TASK-058 | Render settings group in `command-menu.tsx` root frame (after pages, before actions). Each setting row → `push({ kind: "setting", settingId })` on select. Show current value as inline badge on row. | | |
| TASK-059 | Render setting drill frame in content switch. Pass bound setting from `useBoundSettings()`. | | |
| TASK-060 | Remove old theme cycle action from `registry/actions.ts`. Remove `nextTheme` helper if unused. | | |
| TASK-061 | Add Paraglide keys: `command_menu_setting_theme_label`, `command_menu_setting_theme_hint`, `theme_system_label`, `theme_light_label`, `theme_dark_label`, `command_menu_section_settings`. | | |
| TASK-062 | Tests: `registry/settings/__tests__/theme.test.ts` (options shape, hotkey, toastKey, id uniqueness). | | |
| TASK-063 | Test: `components/__tests__/setting-drill.test.tsx` — generic render, current marker, write+toast+pop. | | |
| TASK-064 | Test: `components/__tests__/command-menu.test.tsx` — flow: open menu → select Theme row → 3 options visible → check on system → select Light → `setTheme("light")` called → frame popped. | | |
| TASK-065 | Test: `registry/__tests__/index.test.ts` — `id` uniqueness across all contributions. | | |
| TASK-066 | Changeset minor `@ent-mcp/client`. End-user sentence: "Theme picker is now an inline drill-in inside the command menu instead of a cycling toggle." | | |
| TASK-067 | Run `vp check && vp test`. Open PR. | | |

### Implementation Phase 6

- GOAL-006: Add `LOCALE_SETTING`. Resolve `needsReload` via Paraglide hot-swap probe.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-068 | Probe Paraglide locale runtime: write throwaway test or quick spike to determine if `setLocale()` mid-session updates rendered messages without reload. Document result inline at top of `registry/settings/locale.ts`. | | |
| TASK-069 | Create `features/command-menu/registry/settings/locale.ts`. Export `LOCALE_SETTING: SettingItem<Locale>`. `options` from `SUPPORTED_LOCALES`. `labelKey: "locale_<code>_label"` per locale. | | |
| TASK-070 | Implement `needsReload` per probe result: `() => false` (hot-swap works) OR `(next, current) => next !== current` (250ms `setTimeout` reload after toast). | | |
| TASK-071 | Wire `LOCALE_SETTING` runtime bind in `use-bound-settings.ts`: `read: () => getLocale()`, `write: (l) => setLocale(l, { reload: needsReload(l, current) })`. | | |
| TASK-072 | Append `LOCALE_SETTING` to `COMMAND_SETTINGS` array in `registry/settings/index.ts`. | | |
| TASK-073 | Add Paraglide keys: `command_menu_setting_locale_label`, `command_menu_setting_locale_hint`, `locale_<code>_label` for each `SUPPORTED_LOCALES` entry. | | |
| TASK-074 | Tests: `registry/settings/__tests__/locale.test.ts` — options length matches `SUPPORTED_LOCALES`, ids match. | | |
| TASK-075 | Test (manual checklist in PR): switch locale via menu → verify rendered messages update (or reload triggered). | | |
| TASK-076 | Changeset minor `@ent-mcp/client`. End-user sentence: "Added a language picker to the command menu so users can switch locales without leaving the page." | | |
| TASK-077 | Run `vp check && vp test`. Open PR. | | |

### Implementation Phase 7

- GOAL-007: Wire `useSearchResults` into menu. Drop pool-as-search-source. Pool stays for recents/trending only.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-078 | Create `features/command-menu/api.ts` Hono client wrapper. Exports `api.search({ q, kind, limit })`. Validates response via `searchResponseSchema`. | | |
| TASK-079 | Create `features/command-menu/query-keys.ts`: `searchKeys.all`, `searchKeys.list(q, kind)`. | | |
| TASK-080 | Create `features/command-menu/errors.ts`: `class CommandMenuError extends Error`. | | |
| TASK-081 | Create `features/command-menu/hooks/use-search-results.ts`. `useDeferredValue` + 200ms debounce util. Gate `q.trim().length >= 2`. `useQuery({ staleTime: 30_000, placeholderData: prev })`. | | |
| TASK-082 | Add small debounce hook `lib/use-debounced-value.ts` if not already shared. Otherwise reuse from `shared/hooks`. | | |
| TASK-083 | Update `command-menu.tsx` root + scope frames: when `q.length >= 2` → call `useSearchResults(q, scopeKind)`. Render results group replacing trending. While pending → keep trending + skeleton row. Error → inline retry row inside results group. | | |
| TASK-084 | Stop using `pool` for query-time fuzzy match. Pool consumed only for recents (`pool.find(id)`) + trending (when `q === ""` + scope frame). Remove pool-derived match-value path from `mediaItems` selector. | | |
| TASK-085 | Update `useSections` (now `use-sections.ts`) selectors: `mediaItems` derives from `searchResults.data?.results` when query present, otherwise empty (recents/trending paths unchanged). | | |
| TASK-086 | Tests: `hooks/__tests__/use-search-results.test.ts` — gate at <2 chars, debounce timing, error → retry path, scope filter forwarded to api. | | |
| TASK-087 | Test: `components/__tests__/command-menu.test.tsx` — type query → mock api returns 3 results → results group renders. Network error → retry row. | | |
| TASK-088 | Update integration site `routes/_authenticated/_app/route.tsx` if any prop shape changed (provider value type unchanged). | | |
| TASK-089 | Add `searchKeys` to root query-keys index if such convention exists; otherwise feature-local only. | | |
| TASK-090 | Changeset minor `@ent-mcp/client`. End-user sentence: "Command menu search now returns live results from the server instead of a small in-memory list." | | |
| TASK-091 | Run `vp check && vp test`. Open PR. | | |

## 3. Alternatives

- **ALT-001**: Runtime `register()` function for contributions instead of static arrays. Rejected: worse tree-shaking, harder test isolation, encourages runtime conditions that are better expressed via `enabled?: () => boolean`.
- **ALT-002**: Provider-tree `<CommandMenuContribution kind="..." />` per feature. Rejected: best feature isolation but added React overhead + indirection w/o concrete benefit at current contribution count.
- **ALT-003**: Inline expandable row instead of drill-in sub-page. Rejected: custom cmdk affordance, worse for >2 options, breaks established scope-drill muscle memory.
- **ALT-004**: Cycle-on-Enter for settings (current theme behavior generalized). Rejected: bad UX for >2 options or unfamiliar settings; users can't see options before choosing.
- **ALT-005**: Hybrid local pool + backend top-up search. Rejected v1: extra complexity, dual-source race conditions. Live-only is simpler; pool stays for recents/trending only.
- **ALT-006**: Plugin-search per source (skip aggregator). Rejected: catalog-service already aggregates for home; reuse same path.
- **ALT-007**: `react-hotkeys-hook` instead of `@tanstack/react-hotkeys`. Rejected: TanStack ships meta-driven cheatsheet via `useHotkeyRegistrations` + cross-platform `Mod` + sequences in one API.
- **ALT-008**: Keep custom keydown handler. Rejected: no cross-platform Mod, no sequences, no meta for cheatsheet.

## 4. Dependencies

- **DEP-001**: `@tanstack/react-hotkeys` (new client dep). Phase 4.
- **DEP-002**: Existing `cmdk@^1.1.1`. Unchanged.
- **DEP-003**: Existing `@tanstack/react-query@^5.100.9`. Used phase 7.
- **DEP-004**: Existing `@tanstack/react-router@^1.169.1`. Used phase 4 (sequence navigation).
- **DEP-005**: Existing `next-themes@^0.4.6`. Used phase 5 (theme runtime bind).
- **DEP-006**: Existing Paraglide JS runtime (`apps/client/src/paraglide`). Used phase 6 (locale runtime bind + reload probe).
- **DEP-007**: Existing better-auth middleware mounted on `/api/*`. Used phase 1.
- **DEP-008**: Existing catalog-service search aggregator. Used phase 1.
- **DEP-009**: Existing `@ent-mcp/shared/home` `compactMediaItemSchema`. Reused phase 1.
- **DEP-010**: Diagnostics service (phase 1 server err logging).

## 5. Files

### Phase 1 (server + shared)

- **FILE-001**: `packages/shared/src/search/schemas.ts` — new. Zod schemas.
- **FILE-002**: `packages/shared/src/search/types.ts` — new. Inferred TS types.
- **FILE-003**: `packages/shared/src/search/index.ts` — new. Barrel.
- **FILE-004**: `packages/shared/package.json` — modify. Add subpath export.
- **FILE-005**: `apps/server/src/routes/search.ts` — new. Hono handler.
- **FILE-006**: `apps/server/src/routes/index.ts` (or root mount) — modify. Register route.
- **FILE-007**: `apps/server/src/routes/__tests__/search.test.ts` — new. Integration test.

### Phase 2 (move)

- **FILE-008**: `apps/client/src/features/command-menu/{components,hooks,lib,registry,registry/settings}/` — new dirs.
- **FILE-009**: All files under `apps/client/src/app/command-menu/` — moved into feature module subdirs per spec §4.
- **FILE-010**: `apps/client/src/app/command-menu.tsx` — new thin mount file.
- **FILE-011**: `apps/client/src/app/command-menu/` — deleted dir.
- **FILE-012**: `apps/client/src/shared/components/command-menu-media-provider.tsx` — deleted (folded into feature).
- **FILE-013**: `apps/client/src/features/command-menu/index.ts` — new. Public API.
- **FILE-014**: Import sites: `routes/_authenticated/_app/route.tsx`, `app/app-shell.tsx`, `app/top-nav.tsx`, `app/command-menu-trigger.tsx` — modified imports.

### Phase 3 (nav-stack)

- **FILE-015**: `features/command-menu/types.ts` — extend.
- **FILE-016**: `features/command-menu/lib/nav-stack.ts` — new.
- **FILE-017**: `features/command-menu/lib/__tests__/nav-stack.test.ts` — new.
- **FILE-018**: `features/command-menu/components/command-menu.tsx` — refactor.
- **FILE-019**: `features/command-menu/components/command-search-header.tsx` — new (extracted).
- **FILE-020**: `features/command-menu/components/command-row.tsx` — new (extracted).
- **FILE-021**: `features/command-menu/components/media-row.tsx` — new (extracted).
- **FILE-022**: `features/command-menu/hooks/use-sections.ts` — new (extracted).
- **FILE-023**: `features/command-menu/lib/match-values.ts` — new (extracted).

### Phase 4 (hotkeys)

- **FILE-024**: `apps/client/package.json` — modify. Add `@tanstack/react-hotkeys`.
- **FILE-025**: `features/command-menu/hooks/use-command-hotkeys.ts` — new.
- **FILE-026**: `features/command-menu/hooks/use-command-menu-shortcuts.ts` — deleted.
- **FILE-027**: `features/command-menu/components/shortcuts-cheatsheet.tsx` — new.
- **FILE-028**: `features/command-menu/registry/actions.ts` — modify. Add `act:show-shortcuts`.
- **FILE-029**: `features/command-menu/registry/pages.ts` — modify. Add `sequence` per page.
- **FILE-030**: `apps/client/project.inlang/messages/<locales>` — modify. Add hotkey + cheatsheet keys.
- **FILE-031**: `features/command-menu/hooks/__tests__/use-command-hotkeys.test.tsx` — new.
- **FILE-032**: `features/command-menu/components/__tests__/shortcuts-cheatsheet.test.tsx` — new.

### Phase 5 (theme setting)

- **FILE-033**: `features/command-menu/registry/settings/theme.ts` — new.
- **FILE-034**: `features/command-menu/registry/settings/index.ts` — new.
- **FILE-035**: `features/command-menu/hooks/use-bound-settings.ts` — new.
- **FILE-036**: `features/command-menu/components/setting-drill.tsx` — new.
- **FILE-037**: `features/command-menu/registry/actions.ts` — modify. Remove theme cycle.
- **FILE-038**: `features/command-menu/components/command-menu.tsx` — modify. Render settings group + drill frame.
- **FILE-039**: Paraglide messages — add theme keys.
- **FILE-040**: `features/command-menu/registry/settings/__tests__/theme.test.ts` — new.
- **FILE-041**: `features/command-menu/components/__tests__/setting-drill.test.tsx` — new.
- **FILE-042**: `features/command-menu/registry/__tests__/index.test.ts` — new (id uniqueness).

### Phase 6 (locale setting)

- **FILE-043**: `features/command-menu/registry/settings/locale.ts` — new.
- **FILE-044**: `features/command-menu/registry/settings/index.ts` — modify. Append locale.
- **FILE-045**: `features/command-menu/hooks/use-bound-settings.ts` — modify. Bind locale read/write.
- **FILE-046**: Paraglide messages — add locale keys.
- **FILE-047**: `features/command-menu/registry/settings/__tests__/locale.test.ts` — new.

### Phase 7 (search wire)

- **FILE-048**: `features/command-menu/api.ts` — new.
- **FILE-049**: `features/command-menu/query-keys.ts` — new.
- **FILE-050**: `features/command-menu/errors.ts` — new.
- **FILE-051**: `features/command-menu/hooks/use-search-results.ts` — new.
- **FILE-052**: `features/command-menu/lib/use-debounced-value.ts` — new (or reuse).
- **FILE-053**: `features/command-menu/hooks/use-sections.ts` — modify. Source media items from search query.
- **FILE-054**: `features/command-menu/components/command-menu.tsx` — modify. Render results / pending / error states.
- **FILE-055**: `features/command-menu/hooks/__tests__/use-search-results.test.ts` — new.

## 6. Testing

- **TEST-001**: `apps/server/src/routes/__tests__/search.test.ts` — 200 OK shape, 400 bad kind, 400 q too long, 401 anonymous, scope filter, limit cap. Phase 1.
- **TEST-002**: `features/command-menu/lib/__tests__/nav-stack.test.ts` — push/pop/reset invariants, pop floor at root, frame ordering. Phase 3.
- **TEST-003**: `features/command-menu/components/__tests__/command-menu.test.tsx` — scope drill via stack + Backspace empty input → root. Phase 3.
- **TEST-004**: `features/command-menu/hooks/__tests__/use-command-hotkeys.test.tsx` — Mod+K toggle, `/` open, Esc close/pop, sequence triggers when closed only. Phase 4.
- **TEST-005**: `features/command-menu/components/__tests__/shortcuts-cheatsheet.test.tsx` — registrations grouped + rendered. Phase 4.
- **TEST-006**: `features/command-menu/registry/settings/__tests__/theme.test.ts` — options shape, hotkey, toastKey. Phase 5.
- **TEST-007**: `features/command-menu/components/__tests__/setting-drill.test.tsx` — generic render, current marker, write+toast+pop. Phase 5.
- **TEST-008**: `features/command-menu/components/__tests__/command-menu.test.tsx` — drill flow: select Theme → 3 rows → select Light → setTheme called → frame popped. Phase 5.
- **TEST-009**: `features/command-menu/registry/__tests__/index.test.ts` — id uniqueness across all contributions. Phase 5.
- **TEST-010**: `features/command-menu/registry/settings/__tests__/locale.test.ts` — options length / ids match `SUPPORTED_LOCALES`. Phase 6.
- **TEST-011**: Manual PR checklist (phase 6) — switch locale via menu → verify rendered messages update or reload triggered.
- **TEST-012**: `features/command-menu/hooks/__tests__/use-search-results.test.ts` — gate at <2 chars, debounce, error → retry, scope filter forwarded. Phase 7.
- **TEST-013**: `features/command-menu/components/__tests__/command-menu.test.tsx` — query → mock api → results group renders, network error → retry row. Phase 7.

## 7. Risks & Assumptions

- **RISK-001**: Paraglide locale hot-swap may not work mid-session. Mitigation: probe in phase 6 task TASK-068 before wiring; fall back to `window.location.reload()` w/ 250ms toast.
- **RISK-002**: TanStack Hotkeys bundle size unmeasured. Mitigation: phase 4 changeset notes delta; if >20KB gzipped, file follow-up to lazy-load cheatsheet sub-page.
- **RISK-003**: Hotkey conflict w/ existing browser shortcuts (Mod+K reserved by some browsers). Mitigation: `preventDefault: true` on global Mod+K (default behavior) — already used by current handler.
- **RISK-004**: cmdk default fuzzy may behave differently against larger backend result set. Mitigation: backend already orders by relevance; cmdk treats results list as flat group, no client-side re-sort.
- **RISK-005**: Drill-stack reducer state lost on close. Confirmed by REQ — close → reset is intentional; documenting here so reviewers don't flag as bug.
- **RISK-006**: catalog-service search may not exist or not aggregate plugin sources. Mitigation: phase 1 task TASK-004 verifies; if missing, file blocker before phase 1 PR opens.
- **ASSUMPTION-001**: Catalog-service exposes a search function that returns `CompactMediaItem`-shaped results (used by home).
- **ASSUMPTION-002**: `next-themes` `setTheme` is sync + idempotent (theme bind in phase 5).
- **ASSUMPTION-003**: Paraglide `setLocale` is exposed in current runtime.
- **ASSUMPTION-004**: Existing `/api/*` better-auth middleware is mounted at app level; new `/api/search` route inherits it w/o explicit wiring.
- **ASSUMPTION-005**: `apps/client/src/shared/lib/utils.ts` has `cn` helper (used by extracted components).
- **ASSUMPTION-006**: cmdk `Command` component supports replacing `CommandList` content per render w/o stale internal selection — verified by current scope-drill behavior.
- **ASSUMPTION-007**: Pre-stable status holds → no need to maintain old `nama:open-command` event name beyond phase 4 (kept for top-nav button compat).

## 8. Related Specifications / Further Reading

- [docs/2026-05-08-command-menu-extensible-design.md](../docs/2026-05-08-command-menu-extensible-design.md) — Source spec.
- [docs/2026-04-29-frontend-structure-design.md](../docs/2026-04-29-frontend-structure-design.md) — Frontend feature architecture.
- [docs/2026-05-05-home-page-backend-design.md](../docs/2026-05-05-home-page-backend-design.md) — `compactMediaItemSchema` source.
- [docs/2026-05-08-diagnostics-design.md](../docs/2026-05-08-diagnostics-design.md) — Server error logging seam.
- [TanStack Hotkeys Docs](https://tanstack.com/hotkeys/latest/docs/overview)
- [cmdk Docs](https://cmdk.paco.me)
- [Paraglide JS Docs](https://inlang.com/m/gerre34r/library-inlang-paraglideJs/getting-started)

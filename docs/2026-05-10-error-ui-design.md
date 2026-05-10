# Error UI — Shared `ErrorPage` & `ErrorState`

**Status:** Accepted
**Date:** 2026-05-10
**Author:** Omid Astaraki
**Companions:** `2026-05-08-diagnostics-design.md` (capture pipeline), `2026-04-29-frontend-structure-design.md` (`shared/components/` placement rules)

## Summary

Two shared client primitives unify every user-facing error treatment in the app:

- **`ErrorPage`** — full-viewport stage. Big mono code, gradient-clipped glyph, animated scan line, soft tone-keyed ambient wash, dotted texture grid. Used for terminal errors that own the whole route (404 not-found, 500 boundary fallback, OAuth invalid-request, route-level feature fallbacks).
- **`ErrorState`** — surface-scoped fallback. Horizontal (row strip) or vertical (centered card). Used inline below a header when one section fails but siblings keep rendering (home row failure, OAuth callback failure inside the settings shell).

Both live in `apps/client/src/shared/components/` per the shared-component rules in the frontend-structure doc.

## Goals

- One visual language for every error — no per-feature one-off styling.
- Composition over flags. Each piece (`Frame`, `Headline`, `Description`, `Actions`, `Details`) is a slot, not a boolean prop.
- Tone-aware ambient styling driven by data attributes + CSS custom properties; no JS color logic.
- All copy goes through paraglide; no hardcoded English in production.
- Raw `error.message` never appears in the visible description — gated behind the `ErrorPageDetails` collapsible to avoid leaking implementation detail (paths, tokens, response bodies).

## Composition tree

```
ErrorPage (tone="info"|"warn"|"danger")
└── ErrorPageFrame                       role="alert", aria-live="polite"
    ├── ErrorPageHeadline (code, eyebrow)
    ├── ErrorPageDescription              localized copy only
    ├── ErrorPageActions                  Button(s) — primary first
    ├── ErrorPageDetails (rows[], reference?, trace?)   collapsible diagnostics
    └── ErrorPageHelp                     optional support links

ErrorScreen
└── ErrorState (orientation="horizontal"|"vertical")
    ├── ErrorStateMedia (size?)
    ├── ErrorStateContent
    │   ├── ErrorStateTitle
    │   └── ErrorStateDescription
    └── ErrorStateActions
```

## Tone system

| Tone     | When                              | Ambient                                    |
| -------- | --------------------------------- | ------------------------------------------ |
| `info`   | 404, expected dead-ends           | `--ring`-keyed soft cyan/teal              |
| `warn`   | rate-limited, offline, transient  | `--primary`-keyed amber                    |
| `danger` | 500, auth-expired, hard failures  | `--destructive`-keyed red (default)        |

Implementation: a CSS custom property `--error-page-ambient` is set per tone via CVA variants on the stage. Two stacked pseudo-elements paint a radial wash + dotted grid, neither of which can be expressed in raw Tailwind utilities. `prefers-reduced-motion` disables the scan animation.

## Variant rules

- `ErrorState` orientation defaults to `horizontal` (single-row strip with min-height). `vertical` for centered card-like fallbacks (used inside `ErrorScreen`).
- `ErrorPageHeadline.code` is the *short* identifier (`"404"`, `"OFFLINE"`, `"500"`); the eyebrow is the namespaced trace string (`"// route.not_found"`).
- `ErrorPageDetails.rows` is the place to surface request id, status, raw error message, etc. Treat this as the "developer view" — every row's `value` may be copied via the inline `CopyButton`.

## Paraglide namespace contract

All error-UI copy lives under the `errors` namespace (`apps/client/messages/errors/{en,fa}.json`). Convention:

| Prefix                     | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `errors_<variant>_*`       | Title / body / eyebrow per error variant               |
| `errors_action_*`          | Reusable button labels                                 |
| `errors_details_*`         | Row labels + section heading inside `ErrorPageDetails` |
| `errors_status_*`          | Short status pills (e.g. `errors_status_server_error`) |

Feature boundaries (e.g. `notifications_*`) keep their own titles/retry copy when the error context is feature-specific; everything else flows through `errors_*`.

## Diagnostics integration

Each feature boundary calls `reportError(err, severity, ctx, code)` from `@/shared/lib/diagnostics/report` so the request id stamped on the response body lines up with the `Ref:` chip in the visible UI. See `2026-05-08-diagnostics-design.md` §Cap.E for the capture flow — this design covers only the visual surface.

## Non-goals

- Toast / inline form errors (those keep their domain-local treatment).
- Animated illustrations or emoji branding.
- Per-locale status copy variants (status pill text is the same string across locales today).

## Migration

In-progress: `RowError` (home), `RowErrorInlineCard` (home pagination), OAuth callback error branch — all migrated in this round. Future targets: connection modal inline banners, plugin-detail failure cards. Inline form-validation banners stay unchanged — they live next to inputs and aren't surface-scope errors.

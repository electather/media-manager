# DESIGN.md — @nama/client

> The existing visual system, captured from `src/globals.css` and the shared UI
> layer. Identity-preservation wins: extend these tokens, do not reinvent them.
> Source of truth is `globals.css`; this doc summarizes intent.

## Color (OKLCH, themed via `.dark`)

Semantic tokens only — never hard-code colors. Tailwind utilities resolve to
`var(--*)` through `@theme inline`.

- **Brand `--primary`:** teal in light (`oklch(0.511 0.096 186)`), warm amber in
  dark (`oklch(0.8 0.135 75)`). Restrained — accent, not flood.
- **Neutrals:** light bg is true white → near-white tints; dark bg is a cool
  blue-grey ramp (hue ~260). Surfaces step bg → card/popover → border.
- **State:** `--success` (green ~155), `--danger`/`--destructive` (red ~25),
  `--progress-watched`. Use these, not raw greens/reds.
- **Charts:** `--chart-1..5` neutral-leaning ramp.

Contrast: body text must clear 4.5:1 on its surface in **both** themes.
`--muted-foreground` is the floor for secondary text — don't go lighter.

## Typography

- **Sans / heading:** Geist Variable (`--font-sans`, `--font-heading`). One
  family, weights for hierarchy — do not pair a second sans.
- **Mono:** Geist Mono (`--font-mono`).
- **Per-locale:** `html[lang="fa"]` swaps to Rubik; locale fonts lazy-load via
  `shared/lib/i18n/fonts.ts`. Keep `--font-sans` as the override seam.
- Cap prose at 65–75ch; `text-wrap: balance` on headings, `pretty` on long text.

## Shape & depth

- **Radius:** `--radius: 0.5rem` base; scale `sm/md/lg/xl` + soft
  `2xl/3xl/4xl` (×1.8–2.6) for hero/media surfaces.
- **Shadows:** subtle `--shadow-*` ramp; `--shadow-hero` for elevated media
  cards; `--nav-frosted-shadow` for the frosted nav.
- **`frosted-glass` utility:** `color-mix` card + `backdrop-filter: blur(18px)`.
  Purposeful (nav, overlays) — not a decorative default. Glass stays rare.
- **Spacing base:** `--spacing: 0.25rem`. `--header-height` and
  `--detail-section-nav-stack` (150px) coordinate sticky offsets — reuse them.

## Motion

- Scroll-driven (`animation-timeline: scroll()`) effects on the media-detail
  modal: title shrink, topbar fade-in, backdrop fade. Always `@supports`-gated
  with static fallbacks.
- Row-track edge fades via `data-at-start/-end` + pseudo-elements (Firefox
  timeline-scope and Chrome mask-repaint bugs documented in CSS — don't
  "simplify" back to named timelines).
- `tw-animate-css` + `motion-safe:` utilities. Ease-out curves, no
  bounce/elastic. Every animation needs a reduced-motion path.

## Layout & components

- Feature-folder architecture under `src/features/*`; shared primitives in
  `src/shared/ui` (Base UI + shadcn-style, CVA variants). **Reuse before
  building** — see the `frontend-feature-architecture` and
  `vercel-*` skills before touching components.
- Sidebar shell (`--sidebar-*` token family) + top nav. Logical properties
  throughout for RTL.

## When extending

1. New color/role → add a `--token` in `:root` AND `.dark`, expose via
   `@theme inline`. Never a one-off literal.
2. Respect both themes and RTL on every change.
3. Match CVA variant patterns in `shared/ui`; don't fork component APIs.
4. Keep glass/blur and heavy motion purposeful and rare.

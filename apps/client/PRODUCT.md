# PRODUCT.md — @nama/client

> Design context for Impeccable. The dashboard for **nama**, a self-hosted
> entertainment management platform with a built-in MCP server.

## Register

**Product.** This is app UI: dashboard, library, media detail, settings,
admin, onboarding. Design SERVES the workflow — it does not sell. The surface
people live in daily, often self-hosters and homelab operators, sometimes
their AI agents acting through the same data via MCP.

## Who / where / why

- **Users:** self-hosters running their own media stack; power users who wire
  up Trakt/TMDB/Plex/Jellyfin/Seerr and notification channels. Comfortable with
  config, allergic to hand-holding.
- **Context:** a long-lived browser tab on desktop, occasionally phone. Used in
  varied ambient light over long sessions — both light and dark themes are
  first-class, not an afterthought.
- **Job:** discover, request, track, and rate movies/TV from one dashboard, and
  manage the plugins + connections that feed it.

## Personality

**Calm · precise · trustworthy.** Quiet utility. Restrained color, dense data
kept legible, the chrome gets out of the way so posters and state read first.
Confidence comes from precision and consistency, not decoration.

## Anti-references (explicitly NOT this)

- **Generic SaaS / Linear-clone** — no gray-card grids, no per-section eyebrow
  kickers, no hero-metric template.
- **Plex / Jellyfin heaviness** — no dark-glassy media-center chrome, no
  oversized backdrops drowning the UI, no cluttered rows.
- **Consumer-streaming (Netflix) gloss** — this is a tool, not a storefront.
- **Enterprise admin blandness** — density is fine, lifelessness is not; craft
  is non-negotiable even on settings pages.

## Constraints

- **Accessibility:** WCAG AA contrast (4.5:1 body, 3:1 large), full keyboard
  nav, and a `prefers-reduced-motion` alternative for every animation. The
  codebase already uses `motion-safe:` utilities — hold that bar.
- **i18n / RTL:** ships multiple locales (incl. `fa` with a Rubik font swap).
  Use logical properties (`inline-start`/`-end`), never left/right.
- **Themes:** light + dark both supported via `.dark` class. Never design for
  one only.
- **Stack:** React 19, TanStack Router/Query, Base UI + shadcn-style primitives,
  Tailwind v4 (OKLCH tokens), Geist Variable, Lucide icons, Sonner toasts.

## Success looks like

Posters and current state are the first thing the eye lands on; data-dense
views stay scannable; nothing on screen could be mistaken for a stock SaaS
template. See DESIGN.md for the concrete visual system.

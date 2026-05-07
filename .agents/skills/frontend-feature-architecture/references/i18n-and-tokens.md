# i18n + Tokens

## Strings → paraglide `m.*`

All user-visible strings via `import { m } from "@/paraglide/messages"`. Zero literals in JSX.

OK: stable code/IDs, `aria-*` w/ stable token (e.g. `aria-label="close"` for icon-only test fixtures — prefer `m.*` though), URL fragments, CSS class names.

Not OK: button labels, tooltip text, headers, empty-state copy, toast messages, error fallback text.

```tsx
<h1>{m.notifications_page_title()}</h1>
<p>{m.notifications_page_subtitle_unread({ count })}</p>
```

Message keys: `<feature>_<surface>_<purpose>` (`notifications_page_title`, `notifications_bulk_delete_failed`).

Define new messages in `apps/client/messages/<feature>/en.json` (+ other locales). Paraglide regenerates `m.*` on `vp dev`/`vp build`. Companion skill: `paraglide-js`.

## Enum label fns

Wire enum → label string via fn in `types.ts`. Single source.

```ts
import { m } from "@/paraglide/messages";

const CATEGORY_LABEL_FNS = {
  media: () => m.notifications_category_media(),
  sync: () => m.notifications_category_sync(),
  auth: () => m.notifications_category_auth(),
  system: () => m.notifications_category_system(),
} as const satisfies Record<NotificationCategory, () => string>;

export function categoryLabel(c: NotificationCategory): string {
  return CATEGORY_LABEL_FNS[c]();
}
```

Reference: [`features/notifications/shared/types.ts`](../../../../apps/client/src/features/notifications/shared/types.ts).

Pattern: const map keyed by enum, `satisfies Record<Enum, () => string>` for compile-time exhaustiveness, fn export for call site.

## META maps

Icon + tailwind tokens per enum value → const map.

```ts
import { FilmIcon, RefreshCwIcon, ShieldIcon, ServerIcon, type LucideIcon } from "lucide-react";

export interface CategoryMeta { Icon: LucideIcon }

export const CATEGORY_META = {
  media: { Icon: FilmIcon },
  sync: { Icon: RefreshCwIcon },
  auth: { Icon: ShieldIcon },
  system: { Icon: ServerIcon },
} satisfies Record<NotificationCategory, CategoryMeta>;
```

Severity META carries icon + tailwind tokens together so consumers don't re-derive:

```ts
export const SEVERITY_META = {
  info:  { Icon: InfoIcon, iconBg: "bg-primary/10", iconColor: "text-primary",
           loudBorder: "border-l-primary", loudBg: "bg-primary/10" },
  warn:  { Icon: AlertTriangleIcon, iconBg: "bg-primary/15", iconColor: "text-primary",
           loudBorder: "border-l-primary", loudBg: "bg-primary/15" },
  error: { Icon: AlertCircleIcon, iconBg: "bg-destructive/10", iconColor: "text-destructive",
           loudBorder: "border-l-destructive", loudBg: "bg-destructive/10" },
} satisfies Record<NotificationSeverity, SeverityMeta>;
```

Consumer reads `SEVERITY_META[item.severity]`. No conditional ladders in components.

## Tailwind tokens

- Use semantic tokens: `bg-primary`, `bg-destructive`, `text-muted-foreground`, `border-border`. Match shadcn palette.
- Opacity variants OK: `bg-primary/10`, `bg-primary/15`.
- No arbitrary hex. No inline `style={{ color: ... }}` for theme colors.
- Spacing: `gap-*`, `p-*`, `space-y-*` per shadcn.
- Companion skills: `shadcn`, `web-design-guidelines`.

## Density / intensity

Render variants → props, not separate components.

```ts
export type Density = "comfortable" | "compact";
export type Intensity = "subtle" | "loud";
```

Defaults at consumer (`density = "comfortable"`, `intensity = "subtle"`). Map prop → tailwind via small lookup or conditional class composition w/ `cn()`.

## Icons

`lucide-react` only. Size via `size-*` class (`size-4`, `size-5`). Companion: `shadcn`.

## See also

- [`data-layer.md`](data-layer.md) — types.ts location of label fns + META.
- [`composition.md`](composition.md) — density/intensity at component level.
- Companions: `paraglide-js`, `shadcn`, `web-design-guidelines`.

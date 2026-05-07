# Composition

## Layering: page → list → row

Three layers per surface:

- **Page** owns state (filters, selection, drawer open), wires Suspense + ErrorBoundary, renders toolbar + list + bulk-bar.
- **List** owns virtualization, paging triggers, the data hook (`useInbox`), and the empty-state branch.
- **Row** is presentational. Receives `item` + selection state + `onToggleSelect`. No data hooks.

Reference:

- Page: [`apps/client/src/features/notifications/inbox/inbox-page.tsx`](../../../../apps/client/src/features/notifications/inbox/inbox-page.tsx)
- List: [`apps/client/src/features/notifications/inbox/inbox-list.tsx`](../../../../apps/client/src/features/notifications/inbox/inbox-list.tsx)
- Row: [`apps/client/src/features/notifications/inbox/inbox-row.tsx`](../../../../apps/client/src/features/notifications/inbox/inbox-row.tsx)

```tsx
export function InboxPage({ filters, onFiltersChange }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.count ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header>{/* title, subtitle */}</header>
      <InboxToolbar
        filters={filters}
        unreadCount={unreadCount}
        onFiltersChange={(next) => {
          setSelected(new Set());
          onFiltersChange(next);
        }}
      />
      <Suspense fallback={<InboxSkeleton />}>
        <InboxList filters={filters} selected={selected} onToggleSelect={onToggle} />
      </Suspense>
      <InboxBulkBar ids={Array.from(selected)} onClear={() => setSelected(new Set())} />
    </div>
  );
}
```

## Suspense + ErrorBoundary placement

The feature ErrorBoundary wraps Suspense at the page level. The page is the sole owner of these wrappers — children should not introduce their own.

```tsx
<NotificationsErrorBoundary>
  <Suspense fallback={<InboxSkeleton />}>
    <InboxList filters={filters} ... />
  </Suspense>
</NotificationsErrorBoundary>
```

The ErrorBoundary fallback resets feature-scoped queries on retry:

```ts
const onRetry = () => {
  void queryClient.resetQueries({ queryKey: notificationsKeys.all });
  reset();
};
```

Reference: [`apps/client/src/features/notifications/shared/error-boundary.tsx`](../../../../apps/client/src/features/notifications/shared/error-boundary.tsx).

Routes that mount the page already have a global `Outlet` boundary; the feature boundary catches feature-specific errors without taking down the whole shell.

## State ownership

The page owns:

- Filter state (or wires it from URL/search params)
- Selection state (`Set<string>`)
- Open/closed state for drawers, dialogs, popovers

Children consume props. Children do not call `useState` for state the page already owns.

When filter state belongs in the URL, drive it through TanStack Router search params at the route, then pass it down as props to the page. Don't wire URL parsing inside the page.

## Density / intensity tokens

Two presentational props that surfaces accept to render at different sizes/intensities (popover row vs full inbox row):

```ts
export type Density = "comfortable" | "compact";
export type Intensity = "subtle" | "loud";
```

Reference: [`apps/client/src/features/notifications/shared/types.ts`](../../../../apps/client/src/features/notifications/shared/types.ts).

Use them when the same component renders in two contexts (page and popover, or page and embed). Default values at the consumer (`density = "comfortable"`, `intensity = "subtle"`).

## Component decomposition

Components longer than ~150 lines should split into a sub-folder of focused parts. Mirror [`apps/client/src/features/home/components/card/`](../../../../apps/client/src/features/home/components/card/):

```
components/card/
├── index.tsx
├── card-image.tsx
├── card-tag-chips.tsx
├── card-quick-action.tsx
├── card-meta.tsx
└── ...
```

`index.tsx` composes the parts. Each part is independently understandable. Don't pre-split — split when a single file becomes hard to scan.

## Forms

Use `react-hook-form` + zod resolver. Submit handler is a mutation hook from the feature. Reference: [`apps/client/src/features/notifications/admin/retention-form.tsx`](../../../../apps/client/src/features/notifications/admin/retention-form.tsx).

## Mobile vs desktop split

For surfaces that render differently on mobile (e.g. popover → bottom drawer):

```tsx
const isMobile = useIsMobile();
if (isMobile) return <Drawer>...</Drawer>;
return <Popover>...</Popover>;
```

Both branches render the same body component. Reference: [`apps/client/src/features/notifications/bell/notification-bell.tsx`](../../../../apps/client/src/features/notifications/bell/notification-bell.tsx).

## See also

- [`react-query.md`](react-query.md) for `useSuspenseQuery` rules.
- [`data-layer.md`](data-layer.md) for ErrorBoundary wiring.
- Companion skills: `vercel-composition-patterns` for compound shapes; `vercel-react-best-practices` for re-render hygiene.

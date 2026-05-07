# Example — flat feature (1 surface)

Hypothetical `widgets` feature: 1 page, list + detail. No admin variant.

## Layout

```
features/widgets/
├── index.ts
├── components/
│   ├── widgets-page.tsx
│   ├── widgets-list.tsx
│   ├── widgets-row.tsx
│   ├── widgets-skeleton.tsx
│   └── widgets-empty.tsx
├── hooks/
│   ├── use-widgets.ts
│   └── use-toggle-widget.ts
├── lib/
│   ├── fetchers.ts
│   ├── query-keys.ts
│   ├── types.ts
│   └── error-boundary.tsx
└── __tests__/
    ├── widgets-page.test.tsx
    └── use-toggle-widget.test.tsx
```

## `lib/types.ts`

```ts
import type { WidgetDto } from "@ent-mcp/shared/widgets";
import { m } from "@/paraglide/messages";

export interface WidgetFilters {
  kind?: "video" | "image";
}

export interface WidgetsApiErrorBody {
  code?: string;
  message?: string;
  [k: string]: unknown;
}

export class WidgetsApiError extends Error {
  readonly status: number;
  readonly body: WidgetsApiErrorBody | null;
  readonly code: string | undefined;

  constructor(status: number, body: WidgetsApiErrorBody | null) {
    super(body?.message ?? `widgets request failed (${status})`);
    this.name = "WidgetsApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

const KIND_LABEL_FNS = {
  video: () => m.widgets_kind_video(),
  image: () => m.widgets_kind_image(),
} as const satisfies Record<NonNullable<WidgetFilters["kind"]>, () => string>;

export function kindLabel(k: NonNullable<WidgetFilters["kind"]>) {
  return KIND_LABEL_FNS[k]();
}

export type { WidgetDto };
```

## `lib/query-keys.ts`

```ts
import type { WidgetFilters } from "./types";

export const widgetsKeys = {
  all: ["widgets"] as const,
  list: (filters: WidgetFilters) => [...widgetsKeys.all, "list", filters] as const,
  listAll: () => [...widgetsKeys.all, "list"] as const,
  detail: (id: string) => [...widgetsKeys.all, "detail", id] as const,
} as const;
```

## `lib/fetchers.ts`

```ts
import { api } from "@/shared/lib/api";
import { safeJson } from "@/shared/lib/errors/safe-json";
import { WidgetsApiError, type WidgetFilters, type WidgetsApiErrorBody } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as WidgetsApiErrorBody | null;
  throw new WidgetsApiError(res.status, body);
}

export async function fetchWidgets(filters: WidgetFilters) {
  const res = await api.widgets.$get({
    query: filters.kind ? { kind: filters.kind } : {},
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchToggleWidget(input: { id: string; enabled: boolean }) {
  const res = await api.widgets[":id"].toggle.$post({
    param: { id: input.id },
    json: { enabled: input.enabled },
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}
```

## `lib/error-boundary.tsx`

```tsx
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { m } from "@/paraglide/messages";
import { widgetsKeys } from "./query-keys";
import { WidgetsApiError } from "./types";

export function WidgetsErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => {
        const qc = useQueryClient();
        const message =
          error instanceof WidgetsApiError && error.body?.message
            ? error.body.message
            : error.message;
        return (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <h2 className="text-lg font-semibold">{m.widgets_error_title()}</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void qc.resetQueries({ queryKey: widgetsKeys.all });
                reset();
              }}
            >
              {m.widgets_error_retry()}
            </Button>
          </div>
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
```

## `hooks/use-widgets.ts`

```ts
import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchWidgets } from "../lib/fetchers";
import { widgetsKeys } from "../lib/query-keys";
import type { WidgetFilters } from "../lib/types";

export function useWidgets(filters: WidgetFilters) {
  return useSuspenseQuery({
    queryKey: widgetsKeys.list(filters),
    queryFn: () => fetchWidgets(filters),
  });
}
```

## `hooks/use-toggle-widget.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchToggleWidget } from "../lib/fetchers";
import { widgetsKeys } from "../lib/query-keys";
import type { WidgetDto } from "../lib/types";

interface ListData { items: WidgetDto[] }

export function useToggleWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchToggleWidget,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: widgetsKeys.listAll() });
      const snapshot = qc.getQueriesData<ListData>({ queryKey: widgetsKeys.listAll() });
      qc.setQueriesData<ListData>({ queryKey: widgetsKeys.listAll() }, (data) =>
        data
          ? {
              ...data,
              items: data.items.map((w) =>
                w.id === input.id ? { ...w, enabled: input.enabled } : w,
              ),
            }
          : data,
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: widgetsKeys.listAll() });
    },
  });
}
```

## `components/widgets-page.tsx`

```tsx
import { Suspense, useState } from "react";
import { m } from "@/paraglide/messages";
import { WidgetsErrorBoundary } from "../lib/error-boundary";
import { WidgetsList } from "./widgets-list";
import { WidgetsSkeleton } from "./widgets-skeleton";
import type { WidgetFilters } from "../lib/types";

interface Props {
  filters: WidgetFilters;
  onFiltersChange: (next: WidgetFilters) => void;
}

export function WidgetsPage({ filters, onFiltersChange }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold">{m.widgets_page_title()}</h1>
      </header>
      <WidgetsErrorBoundary>
        <Suspense fallback={<WidgetsSkeleton />}>
          <WidgetsList filters={filters} />
        </Suspense>
      </WidgetsErrorBoundary>
    </div>
  );
}
```

## `index.ts`

```ts
export { WidgetsPage } from "./components/widgets-page";
```

## See also

- Real example: [`features/notifications`](../../../../../apps/client/src/features/notifications/) (split layout — bigger reference).
- [`folder-layout.md`](../folder-layout.md), [`data-layer.md`](../data-layer.md), [`react-query.md`](../react-query.md).

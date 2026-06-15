import { Suspense, type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface SeedEntry {
  queryKey: readonly unknown[];
  data: unknown;
}

export interface RenderWithProvidersOptions {
  /** Pre-populated query cache entries — keyed by the query factory key. */
  seed?: ReadonlyArray<SeedEntry>;
  /** Suspense fallback under the cache provider. */
  fallback?: ReactNode;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { client: QueryClient } {
  const client = createTestQueryClient();
  for (const entry of options.seed ?? []) {
    client.setQueryData(entry.queryKey, entry.data);
  }
  const utils = render(
    <QueryClientProvider client={client}>
      <Suspense fallback={options.fallback ?? null}>{ui}</Suspense>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

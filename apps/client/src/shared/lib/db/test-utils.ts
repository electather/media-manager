import { QueryClient } from "@tanstack/react-query";
import { createCollection } from "@tanstack/react-db";
import {
  queryCollectionOptions,
  type QueryCollectionConfig,
  type QueryCollectionUtils,
} from "@tanstack/query-db-collection";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

type TestCollectionConfig<T extends object> = Omit<
  QueryCollectionConfig<T>,
  "queryClient" | "queryFn" | "queryKey"
> & {
  id: string;
  queryClient?: QueryClient;
  queryKey?: ReadonlyArray<unknown>;
  queryFn?: () => Promise<Array<T>> | Array<T>;
};

export function createTestCollection<T extends object>(
  config: TestCollectionConfig<T>,
  seedRowsData: Array<T> = [],
) {
  const queryClient = config.queryClient ?? createTestQueryClient();
  const queryKey = config.queryKey ?? [config.id];
  const queryFn = config.queryFn ?? (async () => seedRowsData);
  return createCollection(
    queryCollectionOptions<T>({
      ...config,
      queryClient,
      queryKey,
      queryFn,
    } as QueryCollectionConfig<T>),
  );
}

export function seedRows<T extends object>(
  collection: { utils: QueryCollectionUtils<T> },
  rows: Array<T>,
): void {
  collection.utils.writeBatch(() => {
    collection.utils.writeInsert(rows);
  });
}

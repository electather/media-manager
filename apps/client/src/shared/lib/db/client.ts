import { QueryClient } from "@tanstack/react-query";

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: THIRTY_DAYS_MS,
      staleTime: 0,
    },
  },
});

export type AppQueryClient = typeof queryClient;

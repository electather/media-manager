import { QueryClient } from "@tanstack/react-query";

// Node and browsers clamp setTimeout durations greater than the 32-bit signed
// int max (~24.85 days) to 1ms. TanStack Query schedules its in-memory GC via
// setTimeout(gcTime), so 30-day gcTime fires in 1ms and immediately tears down
// idle queries. We pin in-memory retention to 24 days to stay under the limit;
// IDB persistence (`MAX_AGE_MS` in persister.ts) keeps cached data across page
// reloads independently.
const TWENTY_FOUR_DAYS_MS = 1000 * 60 * 60 * 24 * 24;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: TWENTY_FOUR_DAYS_MS,
      staleTime: 0,
    },
  },
});

export type AppQueryClient = typeof queryClient;

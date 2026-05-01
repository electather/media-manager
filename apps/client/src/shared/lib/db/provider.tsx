import type { ReactNode } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient } from "./client";
import { MAX_AGE_MS, buster, dehydrateOptions, persister } from "./persister";

export function AppDataProvider({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: MAX_AGE_MS,
        buster,
        dehydrateOptions,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query } from "@tanstack/react-query";
import { createStore, del, get, set } from "idb-keyval";

export const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export const idbStore = createStore("ent-mcp", "tsq-cache");

export const idbStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const value = await get<string>(key, idbStore);
    return value ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await set(key, value, idbStore);
  },
  removeItem: async (key: string): Promise<void> => {
    await del(key, idbStore);
  },
};

export const persister = createAsyncStoragePersister({
  storage: idbStorage,
  key: "ent-mcp-tsq",
});

export const buster = `${import.meta.env.VITE_APP_VERSION}-${import.meta.env.VITE_SHARED_VERSION}`;

export const dehydrateOptions = {
  shouldDehydrateQuery: (query: Query): boolean => query.meta?.persist !== false,
};

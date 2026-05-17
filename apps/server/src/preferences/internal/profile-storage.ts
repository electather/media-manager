import * as repo from "../repo";

/**
 * Thin facade over `repo/storage.ts` that keeps the historical `profileStorage`
 * object shape used by engine/rebuild/incremental. Drizzle calls live in repo;
 * this file isolates the rest of the module from the storage import shape.
 */
export type { StoredPreferenceProfile, WriteProfileOptions } from "../repo/storage";

export const profileStorage = {
  read: repo.readProfile,
  write: repo.upsertProfile,
};

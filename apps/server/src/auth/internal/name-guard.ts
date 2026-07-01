import { NAME_MAX_LENGTH } from "@nama/shared/users";

/**
 * Social/OAuth providers supply the display name from their profile without any
 * length gate, on both the create path (first login) AND the update path (every
 * subsequent social login re-syncs the provider `name`). The DB column is
 * validated at NAME_MAX_LENGTH, so both paths must cap over-long names.
 *
 * Returns `{ data }` only when a string `name` exceeds the cap; otherwise
 * returns undefined so Better Auth proceeds with the payload unchanged — a
 * non-object result leaves the write untouched (dist/db/with-hooks.mjs),
 * avoiding a needless clone on every login.
 */
export function truncateOverlongName<T extends { name?: unknown }>(
  data: T,
): { data: T } | undefined {
  if (typeof data.name === "string" && data.name.length > NAME_MAX_LENGTH) {
    return { data: { ...data, name: data.name.slice(0, NAME_MAX_LENGTH) } };
  }
  return undefined;
}

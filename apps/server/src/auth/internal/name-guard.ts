import { NAME_MAX_LENGTH } from "@nama/shared/users";

// Social/OAuth re-syncs `name` on every login (update path) with no provider-side
// length gate, so both create and update paths must cap at NAME_MAX_LENGTH. Returns
// `{ data }` only on truncation; undefined leaves the write untouched (dist/db/with-hooks.mjs
// skips the clone), avoiding a needless clone on every login.
export function truncateOverlongName<T extends { name?: unknown }>(
  data: T,
): { data: T } | undefined {
  if (typeof data.name === "string" && data.name.length > NAME_MAX_LENGTH) {
    return { data: { ...data, name: data.name.slice(0, NAME_MAX_LENGTH) } };
  }
  return undefined;
}

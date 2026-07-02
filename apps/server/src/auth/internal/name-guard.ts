import { NAME_MAX_LENGTH, truncateName } from "@nama/shared/users";

// Social/OAuth re-syncs `name` on every login via update path (#831), capping both
// create and update at NAME_MAX_LENGTH via surrogate-safe truncateName (#950).
// Returns `{ data }` only on truncation; undefined skips the Better Auth clone.
export function truncateOverlongName<T extends { name?: unknown }>(
  data: T,
): { data: T } | undefined {
  if (typeof data.name === "string" && data.name.length > NAME_MAX_LENGTH) {
    // Truncate silently by design: this fires on every login for a long-named
    // provider profile, so a warn here would be recurring noise, not signal.
    return { data: { ...data, name: truncateName(data.name) } };
  }
  return undefined;
}

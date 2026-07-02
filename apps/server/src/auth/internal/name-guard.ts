import { NAME_MAX_LENGTH, truncateName } from "@nama/shared/users";

// Social/OAuth re-syncs `name` on every login with no provider-side length gate
// (#831), so both create and update paths cap at NAME_MAX_LENGTH via shared
// truncateName (surrogate-safe, #950). Returns `{ data }` only on truncation;
// undefined is "no change" — Better Auth skips the clone (common login).
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

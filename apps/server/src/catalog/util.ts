import { uniq } from "es-toolkit/array";

/**
 * Trims and dedupes a list of strings preserving first-seen order. Returns
 * an empty array when the input is missing or has no surviving values.
 * Centralized so the canonical-row builder, the features projector and
 * downstream sanitizers share one definition.
 */
export function dedupeStrings(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return uniq(
    values
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** Trims and returns null when the result is empty. */
export function nullableString(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

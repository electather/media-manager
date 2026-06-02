// Leading-article prefixes stripped before sorting so "The Matrix" files under
// "M" on the A–Z rail. English-only by design: the lens is TMDB-title driven and
// the rail is A–Z + "#", so this matches the mock's alphabetical intent without
// pulling in a locale-aware collator.
const LEADING_ARTICLE_RE = /^(the|a|an)\s+/;

// Unicode combining marks (the `U+0300–U+036F` block) left behind after NFD
// decomposition. Stripping them folds "Amélie" → "amelie" so accented titles
// sort beside their ASCII peers.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Normalizes a display title into the `sort_title` browse key the A–Z lens and
 * the letter rail index off. Pure and deterministic so it is unit-testable in
 * isolation (Rule 9) and produces a stable keyset across hydrate runs:
 *   1. strip a single leading article (`the`/`a`/`an` + whitespace),
 *   2. lowercase,
 *   3. NFD-decompose and drop combining marks to fold diacritics,
 *   4. collapse surrounding whitespace.
 *
 * Returns `""` for a null/blank input so a row whose metadata has not resolved
 * still has a defined sort key (it groups under `#` on the rail).
 */
export function normalizeSortTitle(title: string | null | undefined): string {
  if (!title) return "";
  const folded = title.trim().toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
  return folded.replace(LEADING_ARTICLE_RE, "").trim();
}

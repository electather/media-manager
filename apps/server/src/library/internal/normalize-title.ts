// Strips "the"/"a"/"an" prefix so "The Matrix" sorts under "M" on A–Z rail.
// English-only by design: matches TMDB-title lens intent without locale-aware collator.
const LEADING_ARTICLE_RE = /^(the|a|an)\s+/;

// Combining marks (U+0300–U+036F) from NFD decomposition. Strip to fold diacritics
// ("Amélie" → "amelie") so accented titles sort beside ASCII peers.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Normalizes display title to `sort_title` browse key for A–Z lens. Pure/deterministic (Rule 9).
 * Steps: strip leading article, lowercase, NFD + drop combining marks, trim.
 * Returns "" for null/blank so unresolved metadata groups under "#".
 */
export function normalizeSortTitle(title: string | null | undefined): string {
  if (!title) return "";
  const folded = title.trim().toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
  return folded.replace(LEADING_ARTICLE_RE, "").trim();
}

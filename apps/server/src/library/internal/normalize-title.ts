// Strips "the"/"a"/"an" prefix so "The Matrix" sorts under "M" on A–Z rail.
// English-only by design: matches TMDB-title lens intent without locale-aware collator.
const LEADING_ARTICLE_RE = /^(the|a|an)\s+/;

// Combining marks (U+0300–U+036F) from NFD decomposition. Strip to fold diacritics
// ("Amélie" → "amelie") so accented titles sort beside ASCII peers.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Normalizes display title into `sort_title` browse key for A–Z lens/letter rail.
 * Pure/deterministic (Rule 9) for unit testing + stable keyset across hydrate runs.
 * Steps: (1) strip leading article, (2) lowercase, (3) NFD + drop combining marks, (4) trim.
 * Returns "" for null/blank so unresolved metadata still groups under "#".
 */
export function normalizeSortTitle(title: string | null | undefined): string {
  if (!title) return "";
  const folded = title.trim().toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
  return folded.replace(LEADING_ARTICLE_RE, "").trim();
}

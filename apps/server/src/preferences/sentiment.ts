export type NoteSentiment = "positive" | "negative" | "neutral";

const POSITIVE_TERMS = new Set<string>([
  "love",
  "loved",
  "great",
  "amazing",
  "excellent",
  "perfect",
  "brilliant",
  "wonderful",
  "fantastic",
  "awesome",
  "enjoy",
  "enjoyed",
  "favourite",
  "favorite",
  "masterpiece",
  "gripping",
  "powerful",
  "delightful",
  "outstanding",
  "stunning",
  "beautiful",
  "beautifully",
  "compelling",
  "memorable",
  "thrilling",
  "funny",
  "hilarious",
  "charming",
  "clever",
  "smart",
  "engaging",
  "impressive",
  "good",
  "best",
  "better",
  "solid",
  "strong",
  "thoughtful",
  "refreshing",
]);

const NEGATIVE_TERMS = new Set<string>([
  "hate",
  "hated",
  "boring",
  "bad",
  "awful",
  "terrible",
  "worst",
  "disappointing",
  "weak",
  "poor",
  "dull",
  "tedious",
  "predictable",
  "stupid",
  "dumb",
  "shallow",
  "mediocre",
  "forgettable",
  "tiresome",
  "pretentious",
  "messy",
  "slow",
  "annoying",
  "cringe",
  "unwatchable",
  "flop",
  "overrated",
  "underwhelming",
  "painful",
  "bland",
]);

const NEGATORS = new Set<string>(["not", "never", "no", "nothing", "hardly", "barely"]);

const BOUNDARY = /[\s,.;:!?"'()[\]{}]+/;

/**
 * Lexicon-based sentiment classifier. Deliberately crude for v1: tokenizes on
 * whitespace/punctuation, looks up each token against positive/negative sets,
 * and flips the polarity of a match when preceded within one token by a
 * negator. Replaceable behind this interface per the design doc.
 */
// fallow-ignore-next-line complexity
export function classifySentiment(note: string): NoteSentiment {
  const tokens = tokenize(note);
  let score = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const previous = i > 0 ? tokens[i - 1]! : undefined;
    const negated = previous ? NEGATORS.has(previous) : false;
    if (POSITIVE_TERMS.has(token)) score += negated ? -1 : 1;
    else if (NEGATIVE_TERMS.has(token)) score += negated ? 1 : -1;
  }
  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

/**
 * Returns the subset of the item's TMDB keywords that appear (case-insensitive)
 * as whole tokens in the note. Keeps the rebuild's reinforcement signal aligned
 * with the profile's keyword category without re-running any NLP.
 */
// fallow-ignore-next-line complexity
export function extractNoteKeywords(note: string, itemKeywords: readonly string[]): string[] {
  if (itemKeywords.length === 0) return [];
  const tokens = new Set(tokenize(note));
  const out: string[] = [];
  for (const raw of itemKeywords) {
    const keyword = raw.trim().toLowerCase();
    if (keyword.length === 0) continue;
    if (keyword.includes(" ")) {
      if (note.toLowerCase().includes(keyword)) out.push(keyword);
    } else if (tokens.has(keyword)) {
      out.push(keyword);
    }
  }
  return out;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(BOUNDARY)
    .filter((t) => t.length > 0);
}

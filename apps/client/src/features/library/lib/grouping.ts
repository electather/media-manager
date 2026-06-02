import { groupBy, sortBy } from "es-toolkit";
import { qualitiesOf, serversOf } from "./filtering";
import type { LibraryItem } from "./types";

/** A titled bucket of items rendered as one section within a lens. */
export interface LibraryGroup {
  /** Stable key used for React keys and anchor ids. */
  key: string;
  /** Display label for the section header. */
  label: string;
  items: LibraryItem[];
}

/**
 * Quality tiers in descending fidelity, used to order the Quality lens. A tag
 * not listed here sorts to the end among its peers; extend this when the real
 * API introduces new tiers (e.g. Dolby Vision, HDR10+) so their order is a
 * deliberate decision rather than an alphabetical fallback.
 */
export const QUALITY_TIERS = ["4K HDR", "4K", "HDR", "Atmos"] as const;

function titleSort(items: LibraryItem[]): LibraryItem[] {
  return sortBy(items, [(item) => item.title.toLowerCase()]);
}

/** The leading character used to bucket a title in the A→Z lens. */
export function indexLetter(title: string): string {
  const first = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

/** Group titles alphabetically (A–Z, with a trailing `#` bucket for the rest). */
export function groupByLetter(items: LibraryItem[]): LibraryGroup[] {
  const buckets = groupBy(items, (item) => indexLetter(item.title));
  const letters = Object.keys(buckets).sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b);
  });
  return letters.map((letter) => ({
    key: letter,
    label: letter,
    items: titleSort(buckets[letter] ?? []),
  }));
}

/** The full A–Z + `#` rail, with a flag for which letters actually have titles. */
export function buildAlphabet(items: LibraryItem[]): { letter: string; populated: boolean }[] {
  const populated = new Set(items.map((item) => indexLetter(item.title)));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return [...letters, "#"].map((letter) => ({ letter, populated: populated.has(letter) }));
}

function decadeOf(year: number | undefined): number | null {
  if (year == null) return null;
  return Math.floor(year / 10) * 10;
}

/**
 * Group by release decade, newest first. Items without a year collect into a
 * trailing `unknown` bucket (key `"unknown"`, label resolved by the lens via
 * i18n) so a yearless-only set still renders rather than leaving a blank route.
 */
export function groupByDecade(items: LibraryItem[]): LibraryGroup[] {
  const buckets = groupBy(items, (item) => decadeOf(item.year) ?? "unknown");
  const decades = Object.keys(buckets)
    .filter((key) => key !== "unknown")
    .map(Number)
    .sort((a, b) => b - a)
    .map((decade) => ({
      key: String(decade),
      label: `${decade}s`,
      items: sortBy(buckets[decade] ?? [], [(item) => -(item.year ?? 0)]),
    }));
  const undated = buckets.unknown;
  if (undated && undated.length > 0) {
    decades.push({ key: "unknown", label: "unknown", items: titleSort(undated) });
  }
  return decades;
}

/** Bucket items by every value a multi-valued axis yields (a title can land in many buckets). */
function bucketByValues(
  items: LibraryItem[],
  valuesOf: (item: LibraryItem) => string[],
): Map<string, LibraryItem[]> {
  const buckets = new Map<string, LibraryItem[]>();
  for (const item of items) {
    for (const value of valuesOf(item)) {
      const bucket = buckets.get(value);
      if (bucket) bucket.push(item);
      else buckets.set(value, [item]);
    }
  }
  return buckets;
}

/** Group by server availability; a title appears under each server that hosts it. */
export function groupByServer(items: LibraryItem[]): LibraryGroup[] {
  const buckets = bucketByValues(items, serversOf);
  return [...buckets.keys()].sort().map((server) => ({
    key: server,
    label: server,
    items: titleSort(buckets.get(server) ?? []),
  }));
}

/** Group by quality tier in descending fidelity; a title appears under each tier it carries. */
export function groupByQuality(items: LibraryItem[]): LibraryGroup[] {
  const buckets = bucketByValues(items, qualitiesOf);
  const order = (tier: string) => {
    const index = QUALITY_TIERS.indexOf(tier as (typeof QUALITY_TIERS)[number]);
    return index === -1 ? QUALITY_TIERS.length : index;
  };
  return [...buckets.keys()]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((quality) => ({
      key: quality,
      label: quality,
      items: titleSort(buckets.get(quality) ?? []),
    }));
}

import type { LibraryLens } from "@nama/shared/library";
import type { CompactMediaItem } from "@nama/shared/media";

/** Item carries `sectionKey` for row keying: `server`/`quality` lenses repeat titles across sections. */
export type LibrarySectionEntry =
  | { type: "header"; key: string; label: string }
  | { type: "item"; item: CompactMediaItem; sectionKey: string };

/** Drop a single leading article so a title buckets by its real first word. */
function sortableTitle(title: string): string {
  return title.trim().replace(/^(the|a|an)\s+/i, "");
}

/** Strips leading articles to match Plex/Jellyfin/Emby. Non-alphabetic leads go to `#`. */
export function indexLetter(title: string): string {
  const first = sortableTitle(title).charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

/** The decade bucket for a release year; yearless titles collect under `unknown`. */
function decadeKey(year: number | undefined): string {
  return year == null ? "unknown" : String(Math.floor(year / 10) * 10);
}

/** Server pre-sorts; key is the grouping discriminator, label is header text. Timeline key IS the label (i18n-free token, localized at render via `timelineSectionLabel`). */
function sectionOf(item: CompactMediaItem, lens: LibraryLens): { key: string; label: string } {
  switch (lens) {
    case "az": {
      const key = indexLetter(item.title);
      return { key, label: key };
    }
    case "timeline": {
      // The key IS the label here: a stable, i18n-free token (`"unknown"` or the
      // decade's lead year). The render boundary localizes it via
      // `timelineSectionLabel` — keeping grouping/anchors locale-free.
      const key = decadeKey(item.year);
      return { key, label: key };
    }
    case "server":
    case "quality":
      return { key: item.section?.id ?? "", label: item.section?.label ?? "" };
    case "collections":
      return { key: item.id, label: item.title };
  }
}

/** Splices headers on key changes (design §FE rewire). Headers for `unknown`/empty keys emit to prevent silent drops. Item `sectionKey` enables row keying across repeated titles. */
export function toSectionEntries(
  items: readonly CompactMediaItem[],
  lens: LibraryLens,
): LibrarySectionEntry[] {
  const entries: LibrarySectionEntry[] = [];
  let lastKey: string | null = null;
  for (const item of items) {
    const { key, label } = sectionOf(item, lens);
    if (key !== lastKey) {
      entries.push({ type: "header", key, label });
      lastKey = key;
    }
    entries.push({ type: "item", item, sectionKey: key });
  }
  return entries;
}

/** A header and its items until the next key change. `sectionKey` enables unique row keying across repeated titles. */
export interface LibrarySection {
  key: string;
  label: string;
  items: { item: CompactMediaItem; sectionKey: string }[];
}

/** Reshapes flat stream into discrete sections for header-over-grid rendering. Items before first header start unlabeled section to prevent loss. */
export function toSections(entries: readonly LibrarySectionEntry[]): LibrarySection[] {
  const sections: LibrarySection[] = [];
  for (const entry of entries) {
    if (entry.type === "header") {
      sections.push({ key: entry.key, label: entry.label, items: [] });
      continue;
    }
    let current = sections.at(-1);
    if (current === undefined) {
      current = { key: entry.sectionKey, label: "", items: [] };
      sections.push(current);
    }
    current.items.push({ item: entry.item, sectionKey: entry.sectionKey });
  }
  return sections;
}

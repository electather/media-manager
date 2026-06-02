import type { LibraryLens } from "@ent-mcp/shared/library";
import type { CompactMediaItem } from "@ent-mcp/shared/media";

/**
 * One entry in the flat render list a lens walks: either a section header
 * (rendered as a `SectionHead`) or one item cell. The item entry carries its
 * `sectionKey` so the list can key a row by `id + sectionKey` — the `server`
 * and `quality` lenses repeat the same title once per server / tier (their
 * `json_each` expansion), so `id` alone is not unique down the stream.
 */
export type LibrarySectionEntry =
  | { type: "header"; key: string; label: string }
  | { type: "item"; item: CompactMediaItem; sectionKey: string };

/** Drop a single leading article so a title buckets by its real first word. */
function sortableTitle(title: string): string {
  return title.trim().replace(/^(the|a|an)\s+/i, "");
}

/**
 * The leading character used to bucket a title in the A→Z lens. A leading
 * article (`The`/`A`/`An`) is stripped first so "The Amber Room" files under
 * **A**, matching how Plex, Jellyfin, and Emby sort by letter. Non-alphabetic
 * leads (digits, symbols) collect under `#`.
 */
export function indexLetter(title: string): string {
  const first = sortableTitle(title).charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

/** The decade bucket for a release year; yearless titles collect under `unknown`. */
function decadeKey(year: number | undefined): string {
  return year == null ? "unknown" : String(Math.floor(year / 10) * 10);
}

/**
 * The (key, label) a single item contributes to its section, per lens. The key
 * is the stable grouping discriminator (header inserted when it changes down the
 * stream); the label is the header text. The server now sorts the stream so this
 * is a pure read of each item — no client sorting or grouping.
 *
 * - `az`: first letter of the (article-stripped) title.
 * - `timeline`: the stable decade key (the lead year, e.g. `"2020"`) or
 *   `"unknown"` for yearless titles — both key AND label are this i18n-free
 *   token; the visible header text ("2020s" / "Unknown year") is resolved at the
 *   render boundary by `timelineSectionLabel` so grouping stays locale-free.
 * - `server` / `quality`: the server-supplied `item.section` (id = server/tier,
 *   label = display text). Falls back to an empty key when absent so a row
 *   without a section still renders (it just shares the prior header).
 * - `collections`: not grouped here (the endpoint is group-first); callers
 *   render collection cards directly and never pass this lens in.
 */
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

/**
 * Walk a flat, server-sorted item stream and splice in a section header each
 * time the lens's group key changes (design §FE rewire — server groups, client
 * inserts headers). Pure and allocation-light: one pass, tracking only the
 * last-seen key. Returns a flat `LibrarySectionEntry[]` the lens maps to header
 * + cell nodes; the header for the `unknown`/empty key still emits so a lead
 * bucket is never silently dropped.
 *
 * The item entry's `sectionKey` is the same group key, so a list keys its rows
 * on `${item.id}-${sectionKey}` — required for the `server`/`quality` lenses
 * where one title appears under several sections.
 */
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

/**
 * One contiguous section of the flat stream: a header plus the items that
 * follow it until the next group-key change. The `key`/`label` come from the
 * header; `sectionKey` rides on each row so a list keys on `${item.id}-${
 * sectionKey}` (the `server`/`quality` lenses repeat one title across sections,
 * so `id` alone is not unique).
 */
export interface LibrarySection {
  key: string;
  label: string;
  items: { item: CompactMediaItem; sectionKey: string }[];
}

/**
 * Fold the flat `LibrarySectionEntry[]` into discrete sections so each renders
 * as a `SectionHead` over its own poster grid — preserving the per-section look
 * the client-side `groupBy*` used to produce, now that the server returns one
 * sorted stream and headers are spliced on key change. A pure single pass over
 * the entries; the stream is already header-delimited so this only re-shapes
 * (no sort, no grouping). An item before its first header (defensive — the
 * stream always leads with one) starts an unlabeled section so no row is lost.
 */
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

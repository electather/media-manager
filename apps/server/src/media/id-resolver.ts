import { and, eq } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "../db/client";
import { idMap } from "../db/schema";
import { isNil } from "es-toolkit/predicate";

export type IdField = "imdb_id" | "tvdb_id" | "trakt_id" | "trakt_slug";
export type MediaType = "movie" | "tv";

/**
 * Per-id ownership: which plugin id's contribution is trusted. `"first_writer"`
 * means the first non-null contribution wins. tmdb_id is implicit (it's the key).
 */
export const ID_OWNERSHIP: Record<IdField, string> = {
  tvdb_id: "tvdb",
  trakt_id: "trakt",
  trakt_slug: "trakt",
  imdb_id: "first_writer",
};

export interface IdBundle {
  tmdb_id?: string;
  imdb_id?: string;
  tvdb_id?: string;
  trakt_id?: string;
  trakt_slug?: string;
}

export interface HarvestContext {
  /** Plugin id that produced the bundle, used to enforce ownership rules. */
  pluginId: string;
  /** Set of currently-installed plugin ids. Used to fall back to first-writer for absent owners. */
  installedPlugins: Set<string>;
}

function shouldOverwrite(field: IdField, ctx: HarvestContext, existing: string | null): boolean {
  const owner = ID_OWNERSHIP[field];
  if (owner === "first_writer") return isNil(existing);
  if (!ctx.installedPlugins.has(owner)) {
    return isNil(existing);
  }
  return ctx.pluginId === owner;
}

function assignIdField(
  updates: Record<string, string | number>,
  key: string,
  value: string | undefined,
  field: IdField,
  ctx: HarvestContext,
  existing: string | null,
): void {
  if (value && shouldOverwrite(field, ctx, existing)) updates[key] = value;
}

/**
 * Upserts a bundle of cross-service identifiers into `id_map`. Respects per-field
 * ownership: plugin-owned fields only accept writes from that plugin; `imdb_id`
 * is first-writer; absent-owner fields fall back to first-writer.
 */
// fallow-ignore-next-line complexity
export async function upsertIdBundle(
  bundle: IdBundle,
  mediaType: MediaType,
  ctx: HarvestContext,
): Promise<void> {
  if (!bundle.tmdb_id) return;
  const db = getDb();
  const now = Date.now();
  const existing = await db
    .select()
    .from(idMap)
    .where(and(eq(idMap.tmdbId, bundle.tmdb_id), eq(idMap.mediaType, mediaType)))
    .get();
  if (!existing) {
    await db.insert(idMap).values({
      tmdbId: bundle.tmdb_id,
      mediaType,
      imdbId: bundle.imdb_id ?? null,
      tvdbId: bundle.tvdb_id ?? null,
      traktId: bundle.trakt_id ?? null,
      traktSlug: bundle.trakt_slug ?? null,
      updatedAt: now,
    });
    return;
  }

  const updates: Record<string, string | number> = {};

  if (bundle.imdb_id) {
    if (!existing.imdbId) {
      updates.imdbId = bundle.imdb_id;
    } else if (existing.imdbId !== bundle.imdb_id) {
      consola.debug(
        `[id-map] imdb_id conflict for tmdb_id=${bundle.tmdb_id} ignored (first-writer wins)`,
      );
    }
  }
  assignIdField(updates, "tvdbId", bundle.tvdb_id, "tvdb_id", ctx, existing.tvdbId);
  assignIdField(updates, "traktId", bundle.trakt_id, "trakt_id", ctx, existing.traktId);
  assignIdField(updates, "traktSlug", bundle.trakt_slug, "trakt_slug", ctx, existing.traktSlug);

  if (Object.keys(updates).length === 0) return;
  updates.updatedAt = now;
  await db
    .update(idMap)
    .set(updates)
    .where(and(eq(idMap.tmdbId, bundle.tmdb_id), eq(idMap.mediaType, mediaType)));
}

// fallow-ignore-next-line complexity
export async function getIdBundle(tmdbId: string, mediaType: MediaType): Promise<IdBundle | null> {
  const db = getDb();
  const row = await db
    .select()
    .from(idMap)
    .where(and(eq(idMap.tmdbId, tmdbId), eq(idMap.mediaType, mediaType)))
    .get();
  if (!row) return null;
  return {
    tmdb_id: row.tmdbId,
    imdb_id: row.imdbId ?? undefined,
    tvdb_id: row.tvdbId ?? undefined,
    trakt_id: row.traktId ?? undefined,
    trakt_slug: row.traktSlug ?? undefined,
  };
}

/**
 * Extracts an id bundle from a plugin-produced MediaItem.
 */
// fallow-ignore-next-line complexity
export function extractIds(item: unknown): IdBundle | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const ids = rec["ids"] as Record<string, unknown> | undefined;
  const get = (key: string): string | undefined => {
    const val = ids?.[key];
    if (typeof val === "string" && val.length > 0) return val;
    return undefined;
  };
  const tmdb = get("tmdb_id");
  const imdb = get("imdb_id");
  const tvdb = get("tvdb_id");
  const trakt = get("trakt_id");
  const traktSlug = get("trakt_slug");
  if (!tmdb && !imdb && !tvdb && !trakt) return null;
  return {
    tmdb_id: tmdb,
    imdb_id: imdb,
    tvdb_id: tvdb,
    trakt_id: trakt,
    trakt_slug: traktSlug,
  };
}

/**
 * Given an arbitrary plugin output, harvest every MediaItem-shaped entry and
 * upsert its ids. Works for objects (single details) and arrays (lists/searches).
 */
// fallow-ignore-next-line complexity
export async function harvestIds(
  output: unknown,
  ctx: HarvestContext,
  defaultMediaType?: MediaType,
): Promise<void> {
  const items: unknown[] = [];
  // fallow-ignore-next-line complexity
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if ("ids" in rec) items.push(rec);
    // Search results look like { item: MediaItem, score }, so descend into `item`.
    if (rec["item"]) walk(rec["item"]);
  };
  walk(output);

  for (const item of items) {
    const bundle = extractIds(item);
    if (!bundle) continue;
    const rec = item as Record<string, unknown>;
    const type = (rec["type"] as MediaType | undefined) ?? defaultMediaType;
    if (type !== "movie" && type !== "tv") continue;
    try {
      await upsertIdBundle(bundle, type, ctx);
    } catch (err) {
      consola.warn(`[id-map] harvest failed for tmdb_id=${bundle.tmdb_id}`, err);
    }
  }
}

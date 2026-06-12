import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { LRUCache } from "lru-cache";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { sourcemaps } from "../db/schema/infra/diagnostics";

/** Sentinel cached for `(buildId, fileName)` pairs with no stored or parsable
 *  map, so a stack full of unmapped vendor frames does not re-hit the DB. */
const MISSING = "missing";
type CachedMap = TraceMap | typeof MISSING;

/** Parsed `TraceMap`s are expensive to build and fetch for large bundles, so
 *  lookups (including misses, stored as `MISSING`) are kept in memory keyed by
 *  `buildId:fileName`. `saveSourcemap` evicts the affected keys so a re-upload
 *  is picked up immediately. */
const traceMapCache = new LRUCache<string, CachedMap>({ max: 32 });

/** Clears the entire parsed-map cache. Kept for tests; production upload uses
 *  targeted eviction so a batch of sequential uploads does not cold-start every
 *  already-warmed entry. */
export function resetSourcemapCache(): void {
  traceMapCache.clear();
}

/** Drops just the cache entries that a freshly uploaded `(buildId, fileName)`
 *  could satisfy: the build-scoped key and the filename-only fallback key. */
function evictSourcemapCache(buildId: string, fileName: string): void {
  traceMapCache.delete(`${buildId}:${fileName}`);
  traceMapCache.delete(`:${fileName}`);
}

export interface SourcemapUpload {
  buildId: string;
  fileName: string;
  /** Raw JSON text of the `.map` file. */
  content: string;
}

/** Persists one uploaded sourcemap, replacing any previous map for the same
 *  `(buildId, fileName)` pair. Throws when `content` is not a JSON sourcemap
 *  with a `mappings` field so a corrupt upload fails loudly at the boundary
 *  instead of silently breaking resolution later. */
export async function saveSourcemap(upload: SourcemapUpload): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(upload.content);
  } catch {
    throw new Error("sourcemap content is not valid JSON");
  }
  const mappings = (parsed as { mappings?: unknown } | null)?.mappings;
  if (typeof mappings !== "string") {
    throw new Error("sourcemap content has no `mappings` field");
  }
  const db = getDb();
  const now = Date.now();
  await db
    .insert(sourcemaps)
    .values({
      id: crypto.randomUUID(),
      buildId: upload.buildId,
      fileName: upload.fileName,
      content: upload.content,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [sourcemaps.buildId, sourcemaps.fileName],
      set: { content: upload.content, createdAt: now },
    });
  evictSourcemapCache(upload.buildId, upload.fileName);
}

// Matches the trailing `file:line:column` location of a V8 (`at fn (url:1:2)`)
// or SpiderMonkey/JavaScriptCore (`fn@url:1:2`) stack frame.
const FRAME_LOCATION = /(\(?)(\S+?):(\d+):(\d+)(\)?)\s*$/;

/** Extracts the bundle file basename from a frame URL or path, dropping any
 *  query string or hash fragment appended by cache busting. */
function basenameOf(file: string): string {
  // `String.prototype.split` always yields a non-empty array, so the first and
  // last index accesses are guaranteed present; the `!` only satisfies
  // `noUncheckedIndexedAccess` without a runtime fallback that can never run.
  const withoutQuery = file.split(/[?#]/, 1)[0]!;
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1]!;
}

/** Whether a bundle basename is one we could have a map for: only emitted JS
 *  modules carry sourcemaps, so native and internal frames are skipped. Shared
 *  by frame resolution and cache warming so both target the exact same set. */
function isJsBundle(fileName: string): boolean {
  return fileName.endsWith(".js") || fileName.endsWith(".mjs");
}

/** Reads the newest stored map for a bundle file (optionally scoped to a build)
 *  and parses it into a `TraceMap`. Returns null when no row exists or the
 *  stored content fails to parse — a map that passed the upload check but no
 *  longer parses is treated as missing so the raw frame survives. */
async function fetchTraceMap(fileName: string, buildId?: string): Promise<TraceMap | null> {
  const filters = [eq(sourcemaps.fileName, fileName)];
  if (buildId) filters.push(eq(sourcemaps.buildId, buildId));
  // Newest map wins if the same file name ever appears in multiple builds.
  const row = await getDb()
    .select({ content: sourcemaps.content })
    .from(sourcemaps)
    .where(and(...filters))
    .orderBy(desc(sourcemaps.createdAt))
    .limit(1)
    .get();
  if (!row) return null;
  try {
    return new TraceMap(row.content);
  } catch {
    return null;
  }
}

/** Maps the cache sentinel back to the public `TraceMap | null` contract. */
function unwrap(cached: CachedMap): TraceMap | null {
  return cached === MISSING ? null : cached;
}

/** Cache-fronted accessor for a bundle's parsed `TraceMap`. Misses are cached as
 *  `MISSING` so a stack full of unmapped vendor frames does not hammer the DB. */
async function loadTraceMap(fileName: string, buildId?: string): Promise<TraceMap | null> {
  const cacheKey = `${buildId ?? ""}:${fileName}`;
  const cached = traceMapCache.get(cacheKey);
  if (cached !== undefined) return unwrap(cached);
  const map = await fetchTraceMap(fileName, buildId);
  const value: CachedMap = map ?? MISSING;
  traceMapCache.set(cacheKey, value);
  return map;
}

/** Rewrites one frame's location to the original source position, or returns
 *  null when the frame has no parsable location, no stored map, or the map has
 *  no segment covering the position. */
// fallow-ignore-next-line complexity
async function resolveFrame(frame: string, buildId?: string): Promise<string | null> {
  const match = FRAME_LOCATION.exec(frame);
  if (!match) return null;
  const [, open, file, lineText, columnText, close] = match;
  const fileName = basenameOf(file!);
  // Only JS bundles have maps; skip native/internal frames early.
  if (!isJsBundle(fileName)) return null;
  const map = await loadTraceMap(fileName, buildId);
  if (!map) return null;
  const position = originalPositionFor(map, {
    line: Number(lineText),
    // Stack trace columns are 1-based; trace-mapping expects 0-based.
    column: Number(columnText) - 1,
  });
  if (position.source == null || position.line == null) return null;
  const location = `${position.source}:${position.line}:${(position.column ?? 0) + 1}`;
  const resolved = frame.replace(FRAME_LOCATION, `${open}${location}${close}`);
  if (position.name && !resolved.includes(position.name)) {
    return `${resolved} [${position.name}]`;
  }
  return resolved;
}

/** Collects the distinct JS bundle basenames a stack's frames would load a map
 *  for — the exact set {@link resolveFrame} hits, including the same
 *  `.js`/`.mjs` filter, so warming adds no DB reads the serial pass would not
 *  have made. */
function bundleFilesIn(lines: string[]): string[] {
  const files = new Set<string>();
  for (const line of lines) {
    const match = FRAME_LOCATION.exec(line);
    if (!match) continue;
    const fileName = basenameOf(match[2]!);
    if (isJsBundle(fileName)) files.add(fileName);
  }
  return [...files];
}

/** Translates a minified stack trace to original source positions using the
 *  uploaded sourcemaps. Frames that cannot be resolved are kept verbatim.
 *  Returns null when not a single frame resolved, so callers can store
 *  "no resolution available" as an honest null instead of a copy of the raw
 *  stack. When `buildId` is provided the lookup is scoped to that build's
 *  maps; otherwise the newest map for each bundle file name is used. */
export async function resolveStackTrace(stack: string, buildId?: string): Promise<string | null> {
  const lines = stack.split("\n");
  // Warm every distinct bundle's parsed map concurrently before the per-frame
  // pass, so a cold stack touching N files pays one round of parallel DB reads
  // instead of N serial ones; the loop below then resolves from cache hits.
  await Promise.all(bundleFilesIn(lines).map((file) => loadTraceMap(file, buildId)));
  let resolvedAny = false;
  const out: string[] = [];
  for (const line of lines) {
    const resolved = await resolveFrame(line, buildId);
    if (resolved != null) {
      resolvedAny = true;
      out.push(resolved);
    } else {
      out.push(line);
    }
  }
  return resolvedAny ? out.join("\n") : null;
}

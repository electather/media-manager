import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { LRUCache } from "lru-cache";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { sourcemaps } from "../db/schema/infra/diagnostics";

/** Parsed `TraceMap`s are expensive to build and fetch for large bundles, so
 *  lookups (including misses, stored as `"missing"`) are kept in memory keyed
 *  by `buildId:fileName`. `saveSourcemap` clears the cache so a re-upload is
 *  picked up immediately. */
const traceMapCache = new LRUCache<string, TraceMap | "missing">({ max: 32 });

/** Clears the parsed-map cache. Called on every upload and by tests. */
export function resetSourcemapCache(): void {
  traceMapCache.clear();
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
  await db
    .insert(sourcemaps)
    .values({
      id: crypto.randomUUID(),
      buildId: upload.buildId,
      fileName: upload.fileName,
      content: upload.content,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [sourcemaps.buildId, sourcemaps.fileName],
      set: { content: upload.content, createdAt: Date.now() },
    });
  resetSourcemapCache();
}

// Matches the trailing `file:line:column` location of a V8 (`at fn (url:1:2)`)
// or SpiderMonkey/JavaScriptCore (`fn@url:1:2`) stack frame.
const FRAME_LOCATION = /(\(?)(\S+?):(\d+):(\d+)(\)?)\s*$/;

/** Extracts the bundle file basename from a frame URL or path, dropping any
 *  query string or hash fragment appended by cache busting. */
function basenameOf(file: string): string {
  const withoutQuery = file.split(/[?#]/, 1)[0] ?? file;
  const segments = withoutQuery.split("/");
  return segments[segments.length - 1] ?? withoutQuery;
}

async function loadTraceMap(fileName: string, buildId?: string): Promise<TraceMap | null> {
  const cacheKey = `${buildId ?? ""}:${fileName}`;
  const cached = traceMapCache.get(cacheKey);
  if (cached) return cached === "missing" ? null : cached;
  const db = getDb();
  const filters = [eq(sourcemaps.fileName, fileName)];
  if (buildId) filters.push(eq(sourcemaps.buildId, buildId));
  // Newest map wins if the same file name ever appears in multiple builds.
  const row = await db
    .select({ content: sourcemaps.content })
    .from(sourcemaps)
    .where(and(...filters))
    .orderBy(desc(sourcemaps.createdAt))
    .limit(1)
    .get();
  if (!row) {
    traceMapCache.set(cacheKey, "missing");
    return null;
  }
  try {
    const map = new TraceMap(row.content);
    traceMapCache.set(cacheKey, map);
    return map;
  } catch {
    // A map that passed the upload check but still fails to parse is treated
    // as missing; the raw frame is kept.
    traceMapCache.set(cacheKey, "missing");
    return null;
  }
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
  if (!fileName.endsWith(".js") && !fileName.endsWith(".mjs")) return null;
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

/** Translates a minified stack trace to original source positions using the
 *  uploaded sourcemaps. Frames that cannot be resolved are kept verbatim.
 *  Returns null when not a single frame resolved, so callers can store
 *  "no resolution available" as an honest null instead of a copy of the raw
 *  stack. When `buildId` is provided the lookup is scoped to that build's
 *  maps; otherwise the newest map for each bundle file name is used. */
export async function resolveStackTrace(stack: string, buildId?: string): Promise<string | null> {
  const lines = stack.split("\n");
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

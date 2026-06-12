import { z } from "zod";
import { ERROR_SEVERITIES, ERROR_SOURCES, PERF_KINDS } from "./enums";

export const errorSeveritySchema = z.enum(ERROR_SEVERITIES);
export const errorSourceSchema = z.enum(ERROR_SOURCES);
export const perfKindSchema = z.enum(PERF_KINDS);

/** Bounded value type accepted inside an error report `context`. Scalars only so
 *  authenticated clients cannot smuggle large blobs past the per-field string
 *  caps via an unbounded nested object. `undefined` is accepted at the type
 *  level for ergonomic client call sites — JSON serialization strips it before
 *  the server ever sees it. */
const errorReportContextValueSchema = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
]);

/** Payload the client posts to `POST /api/diagnostics/errors` when reporting a surfaced error. */
export const errorReportSchema = z.object({
  severity: errorSeveritySchema,
  name: z.string().max(200).optional(),
  message: z.string().max(2000),
  stack: z.string().max(10000).optional(),
  route: z.string().max(500).optional(),
  code: z.string().max(200).optional(),
  // Identifies the client build that produced the stack so the server can
  // pick the matching uploaded sourcemaps when resolving minified frames.
  buildId: z.string().max(100).optional(),
  // Cap at 20 keys × 1000-char string values to keep total context size bounded;
  // anything richer should be flattened on the client before reporting.
  context: z
    .record(z.string().max(100), errorReportContextValueSchema)
    .refine((v) => Object.keys(v).length <= 20, {
      message: "context may not have more than 20 keys",
    })
    .optional(),
});
export type ErrorReportPayload = z.infer<typeof errorReportSchema>;

/** Body for `POST /api/diagnostics/sourcemaps` (admin only). One uploaded map
 *  per bundle file; `map` is the raw JSON text of the `.map` file emitted by
 *  the hidden-sourcemap client build. The 20 MB cap bounds memory per upload
 *  while comfortably fitting real-world bundle maps. */
export const sourcemapUploadSchema = z.object({
  buildId: z.string().min(1).max(100),
  // Semantically a JS bundle basename (Vite content-hashed). Constrain to that
  // shape so traversal-looking or wildcard values are rejected at the boundary;
  // the resolver only ever matches frames against `.js`/`.mjs` basenames anyway.
  fileName: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[\w\-.]+\.m?js$/, "must be a JS bundle filename"),
  map: z.string().min(2).max(20_000_000),
});
export type SourcemapUploadBody = z.infer<typeof sourcemapUploadSchema>;

/** Helper that turns a comma-delimited query param into a filtered string-literal list. */
const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const allowed = new Set<string>(values as readonly string[]);
      return raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p): p is T[number] => allowed.has(p));
    });

/** Admin viewer query string for `GET /admin/diagnostics/errors`. */
export const errorListQuerySchema = z.object({
  severity: commaList(ERROR_SEVERITIES),
  source: commaList(ERROR_SOURCES),
  pluginId: z.string().optional(),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  requestId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});
export type ErrorListQuery = z.infer<typeof errorListQuerySchema>;

/** Admin viewer query string for `GET /admin/diagnostics/perf/list`. */
export const perfListQuerySchema = z.object({
  kind: perfKindSchema.optional(),
  route: z.string().optional(),
  pluginId: z.string().optional(),
  requestId: z.string().optional(),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});
export type PerfListQuery = z.infer<typeof perfListQuerySchema>;

/** Admin viewer query for `GET /admin/diagnostics/perf/aggregate`. */
export const perfAggregateQuerySchema = z.object({
  kind: perfKindSchema.optional(),
  groupBy: z.enum(["route", "plugin"]).default("route"),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  requestId: z.string().optional(),
});
export type PerfAggregateQuery = z.infer<typeof perfAggregateQuerySchema>;

/** Body shape for `PUT /admin/diagnostics/config`. Either field may be omitted
 *  to update only one retention; clamping happens at the server boundary. */
export const diagnosticsConfigSchema = z.object({
  errorRetentionDays: z.coerce.number().int().min(7).max(365).optional(),
  perfRetentionDays: z.coerce.number().int().min(1).max(90).optional(),
});
export type DiagnosticsConfigBody = z.infer<typeof diagnosticsConfigSchema>;

/** Body for `PUT /admin/diagnostics/config` w/ only error retention. */
export const errorRetentionSchema = z.object({
  errorRetentionDays: z.coerce.number().int().min(7).max(365),
});
export type ErrorRetentionBody = z.infer<typeof errorRetentionSchema>;

/** Body for `PUT /admin/diagnostics/config` w/ only perf retention. */
export const perfRetentionSchema = z.object({
  perfRetentionDays: z.coerce.number().int().min(1).max(90),
});
export type PerfRetentionBody = z.infer<typeof perfRetentionSchema>;

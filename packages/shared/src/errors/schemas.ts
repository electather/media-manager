import { z } from "zod";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "./enums";

export const errorSeveritySchema = z.enum(ERROR_SEVERITIES);
export const errorSourceSchema = z.enum(ERROR_SOURCES);

/** Payload the client posts to `POST /api/errors` when reporting a surfaced error. */
export const errorReportSchema = z.object({
  severity: errorSeveritySchema,
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  route: z.string().optional(),
  code: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorReportPayload = z.infer<typeof errorReportSchema>;

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

/** Admin viewer query string for `GET /admin/errors`. */
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

/** Body for `PUT /admin/errors/config`. */
export const errorRetentionSchema = z.object({
  errorRetentionDays: z.coerce.number().min(7).max(365),
});
export type ErrorRetentionBody = z.infer<typeof errorRetentionSchema>;

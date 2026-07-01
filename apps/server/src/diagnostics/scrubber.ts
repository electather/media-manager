import { mapValues } from "es-toolkit/object";
import { isNil } from "es-toolkit/predicate";

/** Case-insensitive key fragments that cause a value to be replaced with `[REDACTED]`
 *  before the error context blob is persisted. Additions here are reviewed.
 *  Also reused by `capture.ts` to build the URL query-param scrub regex, so a
 *  fragment added here automatically covers both object keys and URL params. */
export const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwd",
  "pwd",
  "api_key",
  "apikey",
  "api-key",
  // `token` also catches `access_token`, `refresh_token`, `id_token`, etc.
  "token",
  "authorization",
  "bearer",
  // `secret` also catches `client_secret`.
  "secret",
  "credentials",
  "cookie",
  "private_key",
] as const;

const REDACTED = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/** Recursively clones a value, replacing any value under a sensitive key with `[REDACTED]`.
 *  Walks into arrays and objects, converts non-plain objects (Date, URL, Error, Map, Set)
 *  to loggable primitives, and pipes every string leaf through `scrubText` so secrets
 *  embedded inside free-text fields under non-sensitive keys (e.g. `error.stack`,
 *  `error.message`) are caught too — defense in depth on top of the key-based pass. */
// fallow-ignore-next-line complexity
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[DEPTH_LIMIT]";
  if (isNil(value)) return value;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value !== "object") return value;
  // Non-plain objects: convert to a loggable primitive rather than silently dropping fields.
  if (value instanceof Date) {
    // `toISOString()` throws `RangeError` for invalid dates; fall back to a stable string.
    return Number.isFinite(value.getTime()) ? value.toISOString() : "Invalid Date";
  }
  if (value instanceof URL) return scrubText(value.toString());
  // `stack` is included so diagnostics retain the trace; callers must already trust the
  // error origin since stacks can carry file paths. The recursive call routes
  // `message` and `stack` strings through `scrubText` so leaked secrets inside the
  // error text are redacted while the trace structure is preserved.
  if (value instanceof Error)
    return scrub({ name: value.name, message: value.message, stack: value.stack }, depth + 1);
  if (value instanceof Map) return scrub(Object.fromEntries(value), depth + 1);
  if (value instanceof Set) return Array.from(value).map((item) => scrub(item, depth + 1));
  return mapValues(value as Record<string, unknown>, (val, key) =>
    isSensitiveKey(key) ? REDACTED : scrub(val, depth + 1),
  );
}

/** Serializes a scrubbed context blob to JSON; returns null for empty or non-serializable input. */
export function serializeContext(context: Record<string, unknown> | undefined): string | null {
  if (!context || Object.keys(context).length === 0) return null;
  try {
    return JSON.stringify(scrub(context));
  } catch {
    return JSON.stringify({ __serialize_error: true });
  }
}

const BEARER_RE = /\bBearer\s+\S+/gi;

/** Header/payload/signature triplet of base64url segments. Matches free-form JWTs
 *  that leak into error strings or log lines. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** Key=value / key: value matcher for sensitive keys (covers URL params, log-line pairs, and
 *  JSON-embedded pairs). `(?!Bearer\b)` lookahead avoids re-matching after the Bearer pass.
 *  Separator allows an optional trailing quote (JSON `":"` shape) or plain `=`/`: `.
 *  Value matches quoted (single or double) or unquoted (stops at whitespace, `&`, `#`).
 *  Quotes around the value are consumed — acceptable for diagnostic scrubbing. */
const SENSITIVE_KV_RE = new RegExp(
  `\\b([\\w-]*(?:${SENSITIVE_KEY_PATTERNS.join("|")})[\\w-]*)(\\s*"?\\s*[:=]\\s*"?\\s*)(?!Bearer\\b)(?:"[^"]*"|'[^']*'|[^\\s#"'&]+)`,
  "gi",
);

/** Scrubs secrets from a plain text string (e.g. error messages, stack traces, job log
 *  buffer lines). Handles Bearer auth headers, sensitive key=value / key: value pairs
 *  (URL params and log lines alike), and JWT-shaped strings. Shared between the
 *  diagnostics capture path and the job run logger so both pull from the same pattern
 *  inventory. */
export function scrubText(text: string): string {
  return text
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(SENSITIVE_KV_RE, "$1$2[REDACTED]")
    .replace(JWT_RE, "[JWT_REDACTED]");
}

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
 *  Walks into arrays and objects, stops at primitives, and leaves non-plain objects as-is. */
// fallow-ignore-next-line complexity
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[DEPTH_LIMIT]";
  if (isNil(value)) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = scrub(val, depth + 1);
    }
  }
  return out;
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

/** URL query-param key matcher: any param whose key *contains* one of the
 *  shared `SENSITIVE_KEY_PATTERNS` fragments. Substring semantics match the
 *  scrubber's object-key behaviour, so `access_token`, `refresh_token`,
 *  `id_token`, `client_secret`, etc. all hit without per-name entries. */
const SENSITIVE_QUERY_PARAM_RE = new RegExp(
  `([?&])([\\w-]*(?:${SENSITIVE_KEY_PATTERNS.join("|")})[\\w-]*)=([^&\\s#"']+)`,
  "gi",
);

/** Scrubs secrets from a plain text string (e.g. error messages and stack traces).
 *  Handles Bearer auth headers, sensitive URL query params, and JWT-shaped strings. */
export function scrubText(text: string): string {
  // Strip Bearer/token values from auth headers.
  let result = text.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  // Strip sensitive query parameters from URLs.
  result = result.replace(SENSITIVE_QUERY_PARAM_RE, "$1$2=[REDACTED]");
  // Redact JWT-shaped strings (header.payload.signature).
  result = result.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[JWT_REDACTED]",
  );
  return result;
}

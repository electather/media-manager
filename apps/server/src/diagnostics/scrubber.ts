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

const BEARER_RE = /\bBearer\s+\S+/gi;

/** Header/payload/signature triplet of base64url segments. Matches free-form JWTs
 *  that leak into error strings or log lines. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** Key=value / key: value matcher for sensitive keys. Substring semantics around the
 *  pattern fragment cover OAuth variants (`access_token`, `refresh_token`, `id_token`,
 *  `client_secret`, `accessToken`, etc.) without per-name entries. Works for both URL
 *  query params (`?api_key=x`) and log-line pairs (`api_key: x`). The `(?!Bearer\b)`
 *  lookahead avoids re-matching `Authorization: Bearer …` after the Bearer pass
 *  scrubbed it, so the redaction reads cleanly. Value stops at whitespace, `&`,
 *  quotes, and `#` so URL boundaries are respected. */
const SENSITIVE_KV_RE = new RegExp(
  `\\b([\\w-]*(?:${SENSITIVE_KEY_PATTERNS.join("|")})[\\w-]*)(\\s*[:=]\\s*)(?!Bearer\\b)([^\\s#"'&]+)`,
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

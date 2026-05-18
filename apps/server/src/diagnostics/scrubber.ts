import { isNil } from "es-toolkit/predicate";

/** Case-insensitive key fragments that cause a value to be replaced with `[REDACTED]`
 *  before the error context blob is persisted. Additions here are reviewed. */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "api_key",
  "apikey",
  "api-key",
  // `token` also catches `refresh_token`, `id_token`, etc.
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

/** Scrubs secrets embedded in a plain string value.
 *  Handles Bearer/token auth headers, sensitive query params in URLs,
 *  JWT-shaped strings, and high-entropy hex/base64 substrings. */
export function scrubStringValue(s: string): string {
  // Replace Bearer/token auth headers.
  let result = s.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
  // Strip sensitive query parameters from URL-shaped strings.
  result = result.replace(
    /([?&])(password|api_key|apikey|api-key|token|authorization|bearer|secret|credentials|cookie|private_key)=([^&\s#"']+)/gi,
    "$1$2=[REDACTED]",
  );
  // Redact JWT-shaped strings (header.payload.signature, each segment ≥10 chars).
  result = result.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[JWT_REDACTED]",
  );
  // Redact high-entropy hex/base64 substrings ≥32 chars that look like secrets.
  result = result.replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[REDACTED]");
  return result;
}

/** Recursively clones a value, replacing any value under a sensitive key with `[REDACTED]`.
 *  Walks into arrays and objects, stops at primitives, and leaves non-plain objects as-is. */
// fallow-ignore-next-line complexity
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[DEPTH_LIMIT]";
  if (isNil(value)) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value !== "object") {
    if (typeof value === "string") return scrubStringValue(value);
    return value;
  }
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

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

/** Regex-escaped alternation of sensitive key fragments, derived from
 *  `SENSITIVE_KEY_PATTERNS` so the two lists never drift apart. */
const SENSITIVE_KEYS_ALTERNATION = SENSITIVE_KEY_PATTERNS.map((p) =>
  p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
).join("|");

/** Matches `<sensitive_key>=<value>` in query strings or log-like text.
 *  Captures the key in group 1 so we can preserve it in the replacement. */
const KEY_VALUE_PAIR_RE = new RegExp(`\\b(${SENSITIVE_KEYS_ALTERNATION})=([^&\\s#"']+)`, "gi");

/** Matches `<sensitive_key>: <value>` in header-style or log-like text.
 *  Stops at common delimiters so we don't eat unrelated trailing content. */
const KEY_COLON_VALUE_RE = new RegExp(
  `\\b(${SENSITIVE_KEYS_ALTERNATION})\\s*:\\s*([^\\s,;"']+)`,
  "gi",
);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/** Scrubs secrets embedded in a plain string value.
 *  Only redacts in known token contexts (Bearer/key=value/key: value) and
 *  JWT-shaped strings. Plain high-entropy substrings (SHA-256, UUIDs,
 *  CUID2s, encoded payloads) are left intact so diagnostic context stays
 *  debuggable. */
export function scrubStringValue(s: string): string {
  // Replace Bearer auth headers.
  let result = s.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);
  // Strip `<key>=<value>` pairs (covers URL query params and log lines).
  result = result.replace(KEY_VALUE_PAIR_RE, `$1=${REDACTED}`);
  // Strip `<key>: <value>` pairs (covers `Authorization: <token>` style headers).
  result = result.replace(KEY_COLON_VALUE_RE, `$1: ${REDACTED}`);
  // Redact JWT-shaped strings (header.payload.signature, each segment ≥10 chars).
  result = result.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[JWT_REDACTED]",
  );
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

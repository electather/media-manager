import type { z } from "zod";
import { encodeCursor } from "@ent-mcp/shared/home";
import { HttpError } from "../diagnostics/http-errors";

/**
 * Cursor codec shared by every row provider. The wire format is base64-url-
 * encoded JSON; decoded shapes are validated by a row-supplied zod schema so
 * a client cannot craft a payload that smuggles unknown fields past the
 * provider.
 *
 * `encodeCursor` lives in `@ent-mcp/shared/home` because the few clients
 * that have to mint a seed cursor without a round-trip (media-detail's
 * "Similar to" row) must agree on the byte string. Decoding stays here
 * because it couples to zod schemas + `HttpError`.
 *
 * Decoding errors throw `HttpError 400 "home.bad_input"` so cursor failures
 * land on the same code as the orchestrator's missing-cursor rejection,
 * keeping the home-feed error namespace single-prefixed.
 */

function base64urlDecode(input: string): string {
  const pad = (4 - (input.length % 4)) % 4;
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(normalized, "base64").toString("utf8");
}

export { encodeCursor };

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  let decoded: string;
  try {
    decoded = base64urlDecode(cursor);
  } catch {
    throw new HttpError(400, "home.bad_input", "cursor_invalid: base64 decode failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new HttpError(400, "home.bad_input", "cursor_invalid: JSON parse failed");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(400, "home.bad_input", "cursor_invalid: shape rejected");
  }
  return result.data;
}

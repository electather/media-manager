import type { z } from "zod";
import { HttpError } from "../errors/http-errors";

/**
 * Cursor codec shared by every row provider. The wire format is base64-url-
 * encoded JSON; decoded shapes are validated by a row-supplied zod schema so
 * a client cannot craft a payload that smuggles unknown fields past the
 * provider.
 *
 * Decoding errors throw `HttpError 400 "cursor_invalid"` so the orchestrator
 * surfaces a structured 4xx without leaking the payload back to the caller.
 */

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64urlDecode(input: string): string {
  const pad = (4 - (input.length % 4)) % 4;
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(normalized, "base64").toString("utf8");
}

export function encodeCursor(payload: unknown): string {
  return base64urlEncode(JSON.stringify(payload));
}

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  let decoded: string;
  try {
    decoded = base64urlDecode(cursor);
  } catch {
    throw new HttpError(400, "cursor_invalid", "cursor base64 decode failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new HttpError(400, "cursor_invalid", "cursor JSON parse failed");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(400, "cursor_invalid", "cursor shape rejected");
  }
  return result.data;
}

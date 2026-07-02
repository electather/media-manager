import { describe, expect, it } from "vite-plus/test";

import { BaseApiError } from "@/shared/lib/diagnostics/api-error";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { throwOnApiError } from "../throw-on-error";

class TestApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("TestApiError", status, body, `request failed (${status})`);
  }
}

describe("throwOnApiError — null-body 5xx path", () => {
  it("throws with fallback message when the 5xx response has no JSON body", async () => {
    // safeJson returns null for an empty body; throwOnApiError must still
    // produce an error whose message identifies the status code.
    const res = new Response(null, { status: 503 });
    const err = await throwOnApiError(res, TestApiError).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BaseApiError);
    expect((err as BaseApiError).status).toBe(503);
    expect((err as BaseApiError).message).toContain("503");
  });
});

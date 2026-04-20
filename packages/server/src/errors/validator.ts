import { zValidator as baseZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { $ZodType } from "zod/v4/core";
import { badRequest } from "./http-errors";

/** Drop-in replacement for `@hono/zod-validator`'s `zValidator` that throws a
 *  structured `HttpError(400, "http.invalid_input")` on validation failure. */
export function zValidator<T extends $ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return baseZValidator(target, schema, (result) => {
    if (!result.success) {
      throw badRequest("http.invalid_input", result.error.message, { target: String(target) });
    }
  });
}

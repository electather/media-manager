import { zValidator as baseZValidator } from "@hono/zod-validator";
import type { Env, ValidationTargets } from "hono";
import type { ZodSchema, z } from "zod";
import { badRequest } from "./http-errors";

type HasUndefined<T> = undefined extends T ? true : false;

/** Drop-in replacement for `@hono/zod-validator`'s `zValidator` that throws a
 *  structured `HttpError(400, "http.invalid_input")` on validation failure. The
 *  error then flows through `errorCaptureMiddleware`, matching every other
 *  endpoint's response shape. */
export function zValidator<
  T extends ZodSchema,
  Target extends keyof ValidationTargets,
  E extends Env = Env,
  P extends string = string,
  In = z.input<T>,
  Out = z.output<T>,
  I extends {
    in: HasUndefined<In> extends true
      ? {
          [K in Target]?:
            | (In extends ValidationTargets[K]
                ? In
                : { [K2 in keyof In]?: ValidationTargets[K][K2] | undefined })
            | undefined;
        }
      : {
          [K in Target]: In extends ValidationTargets[K]
            ? In
            : { [K2 in keyof In]: ValidationTargets[K][K2] };
        };
    out: { [K in Target]: Out };
  } = {
    in: HasUndefined<In> extends true
      ? {
          [K in Target]?:
            | (In extends ValidationTargets[K]
                ? In
                : { [K2 in keyof In]?: ValidationTargets[K][K2] | undefined })
            | undefined;
        }
      : {
          [K in Target]: In extends ValidationTargets[K]
            ? In
            : { [K2 in keyof In]: ValidationTargets[K][K2] };
        };
    out: { [K in Target]: Out };
  },
>(target: Target, schema: T) {
  return baseZValidator<T, Target, E, P, In, Out, I>(target, schema, (result) => {
    if (!result.success) {
      throw badRequest("http.invalid_input", result.error.message, { target: String(target) });
    }
  });
}

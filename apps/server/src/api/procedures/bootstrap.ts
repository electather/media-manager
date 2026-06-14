import { Hono } from "hono";
import { bootstrapClaimSchema } from "@nama/shared/bootstrap";
import { AuthError, claimBootstrap } from "../../auth";
import { zValidator } from "../../diagnostics/validator";
import { badRequest, conflict } from "../../diagnostics/http-errors";

/**
 * Public first-install endpoint. Mounted at `/api/bootstrap` with no
 * `requireSession` — it is the only sanctioned path to create the first admin
 * and is self-closing once any user exists. The plaintext setup token is
 * supplied by the operator from the boot-log banner; the server only ever
 * stored its hash.
 */
export const bootstrapApp = new Hono().post(
  "/claim",
  zValidator("json", bootstrapClaimSchema),
  async (c) => {
    const body = c.req.valid("json");
    try {
      await claimBootstrap(body);
      return c.json({ ok: true });
    } catch (err) {
      throw toBootstrapHttpError(err);
    }
  },
);

/** Maps the auth module's coded domain errors onto the HTTP envelope. Any
 *  other throw is rethrown so it surfaces as a 500 via the error boundary. */
function toBootstrapHttpError(err: unknown): unknown {
  if (err instanceof AuthError) {
    if (err.code === "bootstrap.already_completed") {
      return conflict("bootstrap.already_completed", "This server is already set up");
    }
    if (err.code === "bootstrap.invalid_token") {
      return badRequest("bootstrap.invalid_token", "Invalid setup token");
    }
  }
  return err;
}

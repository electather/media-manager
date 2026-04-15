import type { Context, Next } from "hono";
import { auth } from "./config";

/** Hono middleware that validates the Better Auth session. */
export async function requireSession(c: Context, next: Next): Promise<void> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    c.status(401);
    c.json({ error: "Unauthorized" });
    return;
  }
  c.set("session", session);
  await next();
}

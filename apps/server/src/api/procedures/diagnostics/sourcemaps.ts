import { Hono } from "hono";
import { sourcemapUploadSchema } from "@ent-mcp/shared/diagnostics";
import { requireSession, requirePermission, PERMISSIONS } from "../../../auth";
import { saveSourcemap } from "../../../diagnostics/sourcemaps";
import { zValidator } from "../../../diagnostics/validator";
import { badRequest } from "../../../diagnostics/http-errors";

/** Admin-only upload endpoint mounted at `/api/diagnostics/sourcemaps` (POST).
 *  CI calls it once per `.map` file after a hidden-sourcemap client build. The
 *  maps are stored privately in the database and never served to browsers —
 *  they exist solely so error ingest can resolve minified stack frames. */
export const sourcemapsApp = new Hono()
  .use("*", requireSession)
  // Sourcemaps are a diagnostics surface, so gate them with the same
  // `admin:server` permission as the rest of `/admin/diagnostics` rather than
  // `admin:plugins`.
  .use("*", requirePermission(PERMISSIONS.ADMIN_SERVER))
  .post("/", zValidator("json", sourcemapUploadSchema), async (c) => {
    const body = c.req.valid("json");
    try {
      await saveSourcemap({
        buildId: body.buildId,
        fileName: body.fileName,
        content: body.map,
      });
    } catch (err) {
      // `saveSourcemap` only throws on malformed map content; surface it as a
      // 400 so a broken CI upload fails loudly instead of poisoning the store.
      throw badRequest("http.invalid_input", err instanceof Error ? err.message : String(err));
    }
    return c.json({ ok: true });
  });

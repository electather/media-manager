import { Hono } from "hono";
import { diagnosticsConfigSchema } from "@ent-mcp/shared/diagnostics";
import { requireSession, requirePermission, PERMISSIONS } from "../../../auth";
import {
  getAppConfig,
  setErrorRetentionDays,
  setPerfRetentionDays,
} from "../../../diagnostics/retention";
import { zValidator } from "../../../diagnostics/validator";
import { adminErrorsApp, errorsReportApp } from "./errors";
import { adminPerfApp } from "./perf";
import { sourcemapsApp } from "./sourcemaps";

/** Frontend-facing diagnostics tree mounted at `/api/diagnostics`. Hosts the
 *  error report POST and the admin-only sourcemap upload; perf reporting from
 *  the FE is deferred to a future Web Vitals iteration. */
export const diagnosticsApp = new Hono()
  .route("/errors", errorsReportApp)
  .route("/sourcemaps", sourcemapsApp);

/** Admin diagnostics tree mounted at `/api/admin/diagnostics`. Permission
 *  gated by `admin:plugins` on every route, including the unified
 *  errors/perf retention config endpoint. */
export const adminDiagnosticsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_PLUGINS))
  .get("/config", async (c) => {
    const cfg = await getAppConfig();
    return c.json(cfg);
  })
  // fallow-ignore-next-line complexity
  .put("/config", zValidator("json", diagnosticsConfigSchema), async (c) => {
    const body = c.req.valid("json");
    const next = await getAppConfig();
    if (body.errorRetentionDays !== undefined) {
      next.errorRetentionDays = await setErrorRetentionDays(body.errorRetentionDays);
    }
    if (body.perfRetentionDays !== undefined) {
      next.perfRetentionDays = await setPerfRetentionDays(body.perfRetentionDays);
    }
    return c.json(next);
  })
  .route("/errors", adminErrorsApp)
  .route("/perf", adminPerfApp);

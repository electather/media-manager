import { Hono } from "hono";
import { discoverApp } from "./procedures/discover";
import { activityApp } from "./procedures/activity";
import { requestsApp } from "./procedures/requests";
import { settingsApp } from "./procedures/settings";
import { pluginsApp } from "./procedures/plugins";
import { connectionsApp } from "./procedures/connections";
import { errorsApp, adminErrorsApp } from "./procedures/errors";
import { requestContextMiddleware, errorCaptureMiddleware } from "../errors/middleware";

/** Hono sub-app that handles all /api/* RPC calls. Re-exported type for client. */
export const appRouter = new Hono()
  .use("*", requestContextMiddleware())
  .use("*", errorCaptureMiddleware())
  .route("/discover", discoverApp)
  .route("/activity", activityApp)
  .route("/requests", requestsApp)
  .route("/settings", settingsApp)
  .route("/plugins", pluginsApp)
  .route("/connections", connectionsApp)
  .route("/errors", errorsApp)
  .route("/admin/errors", adminErrorsApp);

export type AppType = typeof appRouter;

import { Hono } from "hono";
import { discoverApp } from "./procedures/discover";
import { activityApp } from "./procedures/activity";
import { requestsApp } from "./procedures/requests";
import { settingsApp } from "./procedures/settings";
import { pluginsApp } from "./procedures/plugins";
import { connectionsApp } from "./procedures/connections";
import { configPublicApp } from "./procedures/config";
import { errorsApp, adminErrorsApp } from "./procedures/errors";
import { adminJobsApp, userJobsApp } from "./procedures/jobs";
import { adminUsersApp } from "./procedures/users";
import { meApp } from "./procedures/me";
import { preferencesApp } from "./procedures/preferences";
import { notificationsApp, adminNotificationsApp } from "./procedures/notifications";
import { artworkApp } from "./procedures/artwork";
import { homeApp } from "./procedures/home";
import { searchApp } from "./procedures/search";
import { requestContextMiddleware, errorHandler } from "../errors/middleware";

/** Hono sub-app that handles all /api/* RPC calls. Re-exported type for client.
 *  `requestContextMiddleware` sets up the per-request correlation id and ALS
 *  frame; `onError` is where every thrown error lands (HttpError and
 *  unexpected throws alike) — Hono catches handler throws internally and
 *  dispatches them to this single boundary. */
export const appRouter = new Hono()
  .use("*", requestContextMiddleware())
  .route("/discover", discoverApp)
  .route("/activity", activityApp)
  .route("/requests", requestsApp)
  .route("/settings", settingsApp)
  .route("/plugins", pluginsApp)
  .route("/connections", connectionsApp)
  .route("/config/public", configPublicApp)
  .route("/errors", errorsApp)
  .route("/admin/errors", adminErrorsApp)
  .route("/jobs", userJobsApp)
  .route("/admin/jobs", adminJobsApp)
  .route("/admin/users", adminUsersApp)
  .route("/me", meApp)
  .route("/preferences", preferencesApp)
  .route("/notifications", notificationsApp)
  .route("/admin/notifications", adminNotificationsApp)
  .route("/artwork", artworkApp)
  .route("/home", homeApp)
  .route("/search", searchApp)
  .onError(errorHandler);

export type AppType = typeof appRouter;

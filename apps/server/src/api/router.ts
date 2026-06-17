import { Hono } from "hono";
import { discoverApp } from "./procedures/discover";
import { activityApp } from "./procedures/activity";
import { requestsApp } from "./procedures/requests";
import { settingsApp } from "./procedures/settings";
import { pluginsApp } from "./procedures/plugins";
import { connectionsApp } from "./procedures/connections";
import { configPublicApp } from "./procedures/config";
import { bootstrapApp } from "./procedures/bootstrap";
import { onboardingApp } from "./procedures/onboarding";
import { publicTrendingApp } from "./procedures/public";
import { diagnosticsApp, adminDiagnosticsApp } from "./procedures/diagnostics";
import { adminJobsApp, userJobsApp } from "./procedures/jobs";
import { adminUsersApp } from "./procedures/users";
import { adminInvitesApp, invitesApp } from "./procedures/invites";
import { meApp } from "./procedures/me";
import { preferencesApp } from "./procedures/preferences";
import { notificationsApp, adminNotificationsApp } from "./procedures/notifications";
import { artworkApp } from "./procedures/artwork";
import { homeApp } from "./procedures/home";
import { mediaApp } from "./procedures/media";
import { libraryApp } from "./procedures/library";
import { searchApp } from "./procedures/search";
import {
  requestContextMiddleware,
  errorHandler,
  httpPerfMiddleware,
} from "../diagnostics/middleware";
import { publicIpRateLimit } from "./rate-limit";

/** Hono sub-app that handles all /api/* RPC calls. Re-exported type for client.
 *  `requestContextMiddleware` sets up the per-request correlation id and ALS
 *  frame; `onError` is where every thrown error lands (HttpError and
 *  unexpected throws alike) — Hono catches handler throws internally and
 *  dispatches them to this single boundary. */
export type { Auth } from "../auth";

export const appRouter = new Hono()
  .use("*", requestContextMiddleware())
  .use("*", httpPerfMiddleware())
  // Public (session-less) groups get a per-IP limiter; every other group is
  // session-authed and carries its own per-user limits where needed. This runs
  // after the global request-context/perf middleware and is keyed by client IP,
  // not the session (which throws on these routes).
  .use("/config/public/*", publicIpRateLimit)
  .use("/bootstrap/*", publicIpRateLimit)
  .use("/public/*", publicIpRateLimit)
  .route("/discover", discoverApp)
  .route("/activity", activityApp)
  .route("/requests", requestsApp)
  .route("/settings", settingsApp)
  .route("/plugins", pluginsApp)
  .route("/connections", connectionsApp)
  .route("/config/public", configPublicApp)
  .route("/bootstrap", bootstrapApp)
  .route("/public", publicTrendingApp)
  .route("/diagnostics", diagnosticsApp)
  .route("/admin/diagnostics", adminDiagnosticsApp)
  .route("/jobs", userJobsApp)
  .route("/admin/jobs", adminJobsApp)
  .route("/admin/users", adminUsersApp)
  .route("/admin/invites", adminInvitesApp)
  .route("/invites", invitesApp)
  .route("/me", meApp)
  .route("/onboarding", onboardingApp)
  .route("/preferences", preferencesApp)
  .route("/notifications", notificationsApp)
  .route("/admin/notifications", adminNotificationsApp)
  .route("/artwork", artworkApp)
  .route("/home", homeApp)
  .route("/media", mediaApp)
  .route("/library", libraryApp)
  .route("/search", searchApp)
  .onError(errorHandler);

export type AppType = typeof appRouter;

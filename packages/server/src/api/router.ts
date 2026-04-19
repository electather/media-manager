import { Hono } from "hono";
import { discoverApp } from "./procedures/discover";
import { activityApp } from "./procedures/activity";
import { requestsApp } from "./procedures/requests";
import { settingsApp } from "./procedures/settings";
import { pluginsApp } from "./procedures/plugins";
import { connectionsApp } from "./procedures/connections";

/** Hono sub-app that handles all /api/* RPC calls. Re-exported type for client. */
export const appRouter = new Hono()
  .route("/discover", discoverApp)
  .route("/activity", activityApp)
  .route("/requests", requestsApp)
  .route("/settings", settingsApp)
  .route("/plugins", pluginsApp)
  .route("/connections", connectionsApp);

export type AppType = typeof appRouter;

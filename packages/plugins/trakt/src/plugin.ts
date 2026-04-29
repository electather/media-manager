import { definePlugin } from "@ent-mcp/plugin-sdk";
import { startAuth, pollAuth, refreshAuth, testConnection, refreshTokensJob } from "./auth";
import { watchHistory } from "./capabilities/watch-history";
import { watchlist } from "./capabilities/watchlist";
import { ratings } from "./capabilities/ratings";
import { recommendations } from "./capabilities/recommendations";
import { calendar } from "./capabilities/calendar";
import { playback } from "./capabilities/playback";
import { collection } from "./capabilities/collection";
import { userComments } from "./capabilities/user-comments";
import { idResolve } from "./capabilities/id-resolve";

export default definePlugin({
  manifest: {
    id: "trakt",
    name: "Trakt",
    version: "1.2.0",
    description: "Watch history, watchlist, ratings, recommendations, and calendar via Trakt.tv.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api.trakt.tv"],
    sharedCredentialsSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", title: "Trakt client id", "x-secret": true },
        clientSecret: { type: "string", title: "Trakt client secret", "x-secret": true },
      },
      required: ["clientId", "clientSecret"],
    },
    credentialsSchema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        createdAt: { type: "number" },
        expiresIn: { type: "number" },
      },
      required: ["accessToken", "refreshToken", "createdAt", "expiresIn"],
    },
    auth: { kind: "oauth_device" },
    capabilities: {
      watchHistory: { version: "v1", scope: "user" },
      watchlist: { version: "v1", scope: "user" },
      ratings: { version: "v1", scope: "user" },
      recommendations: { version: "v1", scope: "user" },
      calendar: { version: "v1", scope: "user" },
      idResolve: { version: "v1", scope: "global" },
      userComments: { version: "v1", scope: "user" },
      playback: { version: "v1", scope: "user" },
      collection: { version: "v1", scope: "user" },
    },
    poolable: false,
    jobs: [
      {
        id: "refresh-tokens",
        schedule: "*/30 * * * *",
        handler: "refreshTokens",
        perConnection: true,
      },
    ],
  },

  startAuth,
  pollAuth,
  refreshAuth,
  testConnection,

  capabilities: {
    watchHistory,
    watchlist,
    ratings,
    recommendations,
    calendar,
    idResolve,
    userComments,
    playback,
    collection,
  },

  jobs: {
    refreshTokens: refreshTokensJob,
  },
});

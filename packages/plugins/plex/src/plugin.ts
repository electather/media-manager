import { definePlugin } from "@ent-mcp/plugin-sdk";
import { startAuth, pollAuth, testConnection } from "./auth";
import { libraryAvailability } from "./capabilities/library-availability";
import { playback } from "./capabilities/playback";
import { playbackSessions } from "./capabilities/playback-sessions";
import { continueWatching } from "./capabilities/continue-watching";
import { watchHistory } from "./capabilities/watch-history";
import { libraryAdmin } from "./capabilities/library-admin";
import { idResolve } from "./capabilities/id-resolve";
import { PLEX_VERSION } from "./constants";

export default definePlugin({
  manifest: {
    id: "plex",
    name: "Plex",
    version: PLEX_VERSION,
    description:
      "Plex Media Server integration — library availability, sessions, continue watching, history, and admin refreshes.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    // Static floor covers the PIN flow. Per-connection server URLs are resolved
    // dynamically via the `x-allowed-host` extension on userConfigSchema below.
    allowedHosts: ["plex.tv"],
    userConfigSchema: {
      type: "object",
      properties: {
        machineIdentifier: {
          type: "string",
          title: "Plex server identifier",
          description: "Populated from plex.tv/api/v2/resources at auth time.",
        },
        externalServerUrl: {
          type: "string",
          title: "External server URL",
          description:
            "Public URL of your Plex server. Used to build player / web deep links that open on the caller's device.",
          "x-allowed-host": true,
        },
        internalServerUrl: {
          type: "string",
          title: "Internal server URL",
          description:
            "Optional private URL (e.g. http://plex:32400) used by the host for server-to-server fetches. Falls back to the external URL when unset.",
          "x-allowed-host": true,
          "x-private": true,
        },
        plexAccountId: {
          type: "string",
          title: "Plex account id",
          description: "Resolved at auth time; used to filter sessions to the connected account.",
        },
      },
      required: ["machineIdentifier", "externalServerUrl"],
    },
    credentialsSchema: {
      type: "object",
      properties: {
        authToken: { type: "string", "x-secret": true },
      },
      required: ["authToken"],
    },
    auth: { kind: "oauth_device" },
    capabilities: {
      libraryAvailability: { version: "v1", scope: "user" },
      playback: { version: "v1", scope: "user" },
      playbackSessions: { version: "v1", scope: "user" },
      continueWatching: { version: "v1", scope: "user" },
      watchHistory: { version: "v1", scope: "user" },
      libraryAdmin: { version: "v1", scope: "user" },
      idResolve: { version: "v1", scope: "user" },
    },
    poolable: false,
  },

  startAuth,
  pollAuth,
  testConnection,

  capabilities: {
    libraryAvailability,
    playback,
    playbackSessions,
    continueWatching,
    watchHistory,
    libraryAdmin,
    idResolve,
  },
});

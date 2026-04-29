import { definePlugin, toErrorMessage } from "@ent-mcp/plugin-sdk";
import type { AuthResult } from "@ent-mcp/plugin-sdk";
import {
  pickFetchBase,
  authHeader,
  unauthenticatedAuthHeader,
  getUserCfg,
  getAccessToken,
} from "./client";
import { libraryAvailability } from "./capabilities/library-availability";
import { playback } from "./capabilities/playback";
import { playbackSessions } from "./capabilities/playback-sessions";
import { continueWatching } from "./capabilities/continue-watching";
import { watchHistory } from "./capabilities/watch-history";
import { libraryAdmin } from "./capabilities/library-admin";
import { idResolve } from "./capabilities/id-resolve";
import type { JellyfinCreds, JellyfinUserCfg, Ctx } from "./types";

export default definePlugin({
  manifest: {
    id: "jellyfin",
    name: "Jellyfin",
    version: "1.0.2",
    description:
      "Self-hosted Jellyfin server integration. Users sign in with their Jellyfin username and password; the plugin caches an access token and the resolved Jellyfin user id per connection.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: [],
    userConfigSchema: {
      type: "object",
      properties: {
        externalServerUrl: {
          type: "string",
          title: "External server URL",
          description: "Public URL of your Jellyfin server (used for play links).",
          "x-allowed-host": true,
        },
        internalServerUrl: {
          type: "string",
          title: "Internal server URL",
          description:
            "Optional private URL used for server-to-server fetches (e.g. http://jellyfin:8096 inside docker). Never shown to clients. Falls back to the external URL when unset.",
          "x-allowed-host": true,
          "x-private": true,
        },
        username: {
          type: "string",
          title: "Username",
        },
        password: {
          type: "string",
          title: "Password",
          description:
            "Collected from the form and promoted into the encrypted credentials blob by startAuth; never persisted in userConfig.",
          "x-secret": true,
          writeOnly: true,
        },
        userId: {
          type: "string",
          title: "Jellyfin user id",
          description: "Resolved by the server on connect. Not user-editable.",
          readOnly: true,
          "x-plugin-resolved": true,
        },
      },
      required: ["externalServerUrl", "username"],
      additionalProperties: false,
    },
    credentialsSchema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        password: { type: "string" },
      },
      required: ["accessToken", "password"],
    },
    auth: { kind: "form" },
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

  async startAuth(ctx, input): Promise<AuthResult> {
    const cfg = input as (JellyfinUserCfg & { password?: string }) | null;
    if (!cfg?.externalServerUrl) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "externalServerUrl is required",
      };
    }
    const priorCreds = ctx.credentials as JellyfinCreds | null;
    const password = cfg.password ?? priorCreds?.password;
    if (!cfg.username || !password) {
      return {
        status: "error",
        code: "plugin.input_invalid",
        devMessage: "username and password are required",
      };
    }

    const base = pickFetchBase(cfg);
    const authRes = await ctx.fetch(`${base}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        Authorization: unauthenticatedAuthHeader(),
      },
      body: JSON.stringify({ Username: cfg.username, Pw: password }),
    });

    if (authRes.status === 401 || authRes.status === 403) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "invalid username or password",
      };
    }
    if (!authRes.ok) {
      return {
        status: "error",
        code: "plugin.upstream_error",
        devMessage: `Jellyfin auth failed with status ${authRes.status}`,
      };
    }

    const body = (await authRes.json()) as {
      AccessToken: string;
      User?: { Id: string };
    };
    if (!body.AccessToken) {
      return {
        status: "error",
        code: "plugin.upstream_error",
        devMessage: "Jellyfin did not return an access token",
      };
    }

    let userId = body.User?.Id;
    if (!userId) {
      const meRes = await ctx.fetch(`${base}/Users/Me`, {
        headers: { accept: "application/json", ...authHeader(body.AccessToken) },
      });
      if (!meRes.ok) {
        return {
          status: "error",
          code: "plugin.upstream_error",
          devMessage: `Jellyfin /Users/Me failed with status ${meRes.status}`,
        };
      }
      const me = (await meRes.json()) as { Id: string };
      userId = me.Id;
    }

    return {
      status: "completed",
      credentials: { accessToken: body.AccessToken, password } satisfies JellyfinCreds,
      userConfigPatch: { userId, password: null },
    };
  },

  async testConnection(ctx) {
    try {
      const cfg = getUserCfg(ctx as Ctx);
      const base = pickFetchBase(cfg);
      const token = getAccessToken(ctx as Ctx);
      const res = await ctx.fetch(`${base}/Users/Me`, {
        headers: { accept: "application/json", ...authHeader(token) },
      });
      if (res.status === 401) return { ok: false, message: "token invalid or expired" };
      if (!res.ok) return { ok: false, message: `Jellyfin ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

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

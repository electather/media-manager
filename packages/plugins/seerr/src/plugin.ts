import { definePlugin, toErrorMessage } from "@ent-mcp/plugin-sdk";
import type { AuthResult } from "@ent-mcp/plugin-sdk";
import { getBaseUrl, getSessionCookie, extractSessionCookie } from "./client";
import { mediaRequest, syncRequestStatuses } from "./capabilities/media-request";
import type { Ctx, SeerrUserCfg, SeerrGlobalCfg } from "./types";

export default definePlugin({
  manifest: {
    id: "seerr",
    name: "Seerr",
    version: "1.3.0",
    description:
      "Media request management via Seerr. Admins set the server URL; users sign in with their Seerr email and password and the plugin keeps a session cookie per user.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    // The baseUrl is admin-configured and marked x-allowed-host so the runtime
    // adds it to the per-request allowlist after passing it through isBlockedHostname.
    allowedHosts: [],
    globalConfigSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          title: "Seerr URL",
          description: "Base URL of your Seerr instance (e.g. https://requests.example.com).",
          "x-allowed-host": true,
        },
      },
      required: ["baseUrl"],
    },
    userConfigSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          title: "Email address",
        },
        password: {
          type: "string",
          title: "Password",
          "x-secret": true,
        },
      },
      required: ["username", "password"],
      additionalProperties: false,
    },
    credentialsSchema: {
      type: "object",
      properties: {
        sessionCookie: { type: "string" },
        userId: { type: "number" },
      },
      required: ["sessionCookie", "userId"],
    },
    auth: { kind: "form" },
    capabilities: {
      mediaRequest: { version: "v1", scope: "user" },
    },
    poolable: false,
    jobs: [
      {
        id: "requestStatusSync",
        // Every 5 minutes; matches the polling cadence the design assumes for
        // request status notifications.
        schedule: "*/5 * * * *",
        handler: "syncRequestStatuses",
        perConnection: true,
      },
    ],
  },

  async startAuth(ctx, input): Promise<AuthResult> {
    const cfg = input as SeerrUserCfg | null;
    const base = (ctx.config.global as SeerrGlobalCfg | null)?.baseUrl;
    if (!base) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "Seerr baseUrl not configured by admin",
      };
    }
    const trimmed = base.replace(/\/$/, "");

    const email = cfg?.username;
    const password = cfg?.password;
    if (!email || !password) {
      return {
        status: "error",
        code: "plugin.input_invalid",
        devMessage: "username and password are required",
      };
    }

    const authRes = await ctx.fetch(`${trimmed}/api/v1/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (authRes.status === 401 || authRes.status === 403) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "invalid email or password",
      };
    }
    if (!authRes.ok) {
      return {
        status: "error",
        code: "plugin.upstream_error",
        devMessage: `Seerr auth failed with status ${authRes.status}`,
      };
    }

    const sessionCookie = extractSessionCookie(authRes);
    if (!sessionCookie) {
      return {
        status: "error",
        code: "plugin.upstream_error",
        devMessage: "Seerr did not return a session cookie",
      };
    }

    const user = (await authRes.json()) as { id: number };

    return {
      status: "completed",
      credentials: {
        sessionCookie,
        userId: user.id,
      },
    };
  },

  async testConnection(ctx) {
    try {
      const res = await ctx.fetch(`${getBaseUrl(ctx as Ctx)}/api/v1/auth/me`, {
        headers: { Cookie: getSessionCookie(ctx as Ctx) },
      });
      if (res.status === 401) return { ok: false, message: "session invalid or expired" };
      if (!res.ok) return { ok: false, message: `Seerr ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  capabilities: {
    mediaRequest,
  },
  jobs: {
    syncRequestStatuses: (ctx) => syncRequestStatuses(ctx as Ctx),
  },
});

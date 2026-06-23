import { definePlugin, toErrorMessage } from "@nama/plugin-sdk";
import type { AuthResult } from "@nama/plugin-sdk";
import { getBaseUrl, getSessionCookie, extractSessionCookie } from "./client";
import { mediaRequest, syncRequestStatuses } from "./capabilities/media-request";
import type { Ctx, SeerrCreds, SeerrUserCfg, SeerrGlobalCfg } from "./types";

export default definePlugin({
  manifest: {
    id: "seerr",
    name: "Seerr",
    version: "1.3.0",
    description:
      "Media request management via Seerr. Admins set the server URL; users sign in with their Seerr email and password and the plugin keeps a session cookie per user.",
    author: { name: "Nama", url: "https://github.com/" },
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
          description:
            "Collected from the form and promoted into the encrypted credentials blob by startAuth; never persisted in userConfig.",
          "x-secret": true,
          writeOnly: true,
        },
      },
      // Password omitted from required: edit form doesn't block on already-promoted
      // credentials. startAuth enforces presence at input and returns plugin.input_invalid
      // with params.field if missing.
      required: ["username"],
      additionalProperties: false,
    },
    credentialsSchema: {
      type: "object",
      properties: {
        sessionCookie: { type: "string" },
        userId: { type: "number" },
        password: { type: "string" },
      },
      // `password` is intentionally not required. Connections created before
      // this fix have no `password` in their credentials blob, and we want
      // the schema to keep validating them; `startAuth` re-populates the
      // field on the next successful auth round-trip.
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
        // Seerr `/request` pagination can legitimately exceed the 60s default
        // on slower instances; widen the per-row budget so a single page fetch
        // doesn't time the whole row out.
        perRowTimeoutSec: 120,
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

    // Require HTTPS for credential submission except on loopback. The email and
    // password are POSTed to this admin-supplied URL, so a non-HTTPS endpoint
    // would expose them in cleartext on the wire.
    try {
      const parsedBase = new URL(trimmed);
      const isLoopback =
        parsedBase.hostname === "localhost" ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsedBase.hostname) ||
        parsedBase.hostname === "[::1]";
      if (parsedBase.protocol !== "https:" && !isLoopback) {
        return {
          status: "error",
          code: "plugin.invalid_base_url",
          devMessage: "Seerr baseUrl must use HTTPS to protect credentials in transit",
        };
      }
    } catch {
      return {
        status: "error",
        code: "plugin.invalid_base_url",
        devMessage: "Seerr baseUrl is not a valid URL",
      };
    }

    // On re-auth (e.g. updateUserConfig), the form-stripped userConfig no
    // longer carries the password — fall back to the copy kept in the
    // encrypted credentials blob, mirroring the Jellyfin pattern.
    const priorCreds = ctx.credentials as Pick<SeerrCreds, "password"> | null;
    const email = cfg?.username;
    const password = cfg?.password ?? priorCreds?.password;
    if (!email) {
      return {
        status: "error",
        code: "plugin.input_invalid",
        devMessage: "username is required",
        params: { field: "username" },
      };
    }
    if (!password) {
      return {
        status: "error",
        code: "plugin.input_invalid",
        devMessage: "password is required",
        params: { field: "password" },
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
        password,
      } satisfies SeerrCreds,
      userConfigPatch: { password: null },
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

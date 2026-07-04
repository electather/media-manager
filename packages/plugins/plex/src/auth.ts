import type { AuthResult, PluginContext } from "@nama/plugin-sdk";
import type { Ctx } from "./types";
import { PLEX_TV_BASE } from "./constants";
import { plexTvHeaders, plexServerFetch } from "./client";
import { toErrorMessage } from "@nama/plugin-sdk";

export async function startAuth(ctx: PluginContext, _input: unknown): Promise<AuthResult> {
  // Plex PIN flow: request a short-lived PIN and direct the user at
  // plex.tv/link to approve it against their account.
  const body = new URLSearchParams({ strong: "true" });
  const res = await ctx.fetch(`${PLEX_TV_BASE}/pins`, {
    method: "POST",
    headers: {
      ...plexTvHeaders(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    return {
      status: "error",
      code: "plugin.upstream_error",
      devMessage: `Plex PIN request failed (${res.status})`,
    };
  }
  const pin = (await res.json()) as {
    id: number;
    code: string;
    expiresIn: number;
  };
  return {
    status: "display_code",
    code: pin.code,
    verifyUrl: "https://plex.tv/link",
    pollState: { pinId: pin.id, pinCode: pin.code },
    // Plex PIN polling interval is not explicit in the API response; 2s is
    // the commonly-recommended cadence from the Plex ecosystem.
    intervalSec: 2,
    expiresAt: Date.now() + pin.expiresIn * 1000,
  };
}

export async function pollAuth(ctx: PluginContext, pollState: unknown): Promise<AuthResult> {
  const state = pollState as { pinId: number; pinCode: string } | null;
  if (!state?.pinId) {
    return {
      status: "error",
      code: "plugin.input_invalid",
      devMessage: "Plex pollAuth missing pinId",
    };
  }
  const res = await ctx.fetch(`${PLEX_TV_BASE}/pins/${state.pinId}`, {
    headers: plexTvHeaders(),
  });
  if (res.status === 404) {
    return {
      status: "error",
      code: "plugin.token_expired",
      devMessage: "Plex PIN expired",
    };
  }
  if (!res.ok) {
    return {
      status: "error",
      code: "plugin.upstream_error",
      devMessage: `Plex PIN poll failed (${res.status})`,
    };
  }
  const body = (await res.json()) as {
    id: number;
    authToken: string | null;
    expiresAt?: string;
  };
  if (!body.authToken) {
    return { status: "pending" };
  }

  // Fetch account id and the list of servers the user has access to so we
  // can cache `plexAccountId` + `machineIdentifier` on the connection and
  // skip a client round-trip.
  const userConfigPatch: Record<string, unknown> = {};
  try {
    const userRes = await ctx.fetch(`${PLEX_TV_BASE}/user`, {
      headers: {
        ...plexTvHeaders(),
        "X-Plex-Token": body.authToken,
      },
    });
    if (userRes.ok) {
      const user = (await userRes.json()) as { id?: number | string };
      if (user.id !== undefined && user.id !== null) {
        userConfigPatch["plexAccountId"] = String(user.id);
      }
    }
  } catch {
    // Swallowed; handled by the missing-plexAccountId guard below.
  }

  // plexAccountId is required — without it getHistory would expose the full
  // server history to this user (#990). Fail setup early rather than letting
  // the connection persist in a broken state.
  if (!userConfigPatch["plexAccountId"]) {
    return {
      status: "error",
      code: "plugin.upstream_error",
      devMessage: "Plex account id missing after auth; cannot complete setup",
    };
  }

  try {
    const resourcesRes = await ctx.fetch(
      `${PLEX_TV_BASE}/resources?includeHttps=1&includeRelay=1`,
      {
        headers: {
          ...plexTvHeaders(),
          "X-Plex-Token": body.authToken,
        },
      },
    );
    if (resourcesRes.ok) {
      const resources = (await resourcesRes.json()) as Array<{
        clientIdentifier: string;
        // `provides` is documented but the real Plex API has been observed
        // omitting it on some resource rows; treat as optional.
        provides?: string;
        owned?: boolean;
        name?: string;
        connections?: Array<{ uri?: string; local?: boolean }>;
      }>;
      // Only trust servers the authenticated user owns. Shared servers are
      // excluded to prevent SSRF via an attacker-controlled server URL.
      const firstServer = resources.find((r) => r.provides?.includes("server") && r.owned === true);
      if (firstServer) {
        userConfigPatch["machineIdentifier"] = firstServer.clientIdentifier;
        // Auto-fill externalServerUrl from first public (local:false) conn,
        // fall back to first conn if Plex doesn't annotate, skip if already
        // set so manual override survives re-auth.
        const publicConn =
          firstServer.connections?.find((c) => c.local === false && Boolean(c.uri)) ??
          firstServer.connections?.find((c) => Boolean(c.uri));
        if (publicConn?.uri) {
          userConfigPatch["externalServerUrl"] = publicConn.uri;
        }
      }
    }
  } catch {
    // Non-fatal; the user can still pick a server manually later.
  }

  return {
    status: "completed",
    credentials: { authToken: body.authToken },
    userConfigPatch,
  };
}

export async function testConnection(
  ctx: PluginContext,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await plexServerFetch(ctx as Ctx, "/identity");
    if (res.status === 401) return { ok: false, message: "Plex token invalid or expired" };
    if (!res.ok) return { ok: false, message: `Plex ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: toErrorMessage(err) };
  }
}

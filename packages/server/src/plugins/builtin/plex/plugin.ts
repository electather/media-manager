import type { LibraryItem } from "@ent-mcp/shared/plugins/library";
import { definePlugin } from "../../../plugin-runtime/define";
import type { AuthResult, PluginContext } from "../../../plugin-runtime/types";
import { pluginError, toErrorMessage } from "../../utils/plugin-error";
import { handleHttpStatus } from "../../utils/http-status";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PlexCreds {
  /** Plex auth token (X-Plex-Token). */
  authToken: string;
}

interface PlexUserCfg {
  /** Identifier of the Plex server the user selected at auth time. */
  machineIdentifier: string;
  /** Public URL used for playerLink/webLink. MUST be reachable from the caller. */
  externalServerUrl: string;
  /** Optional internal URL used by the host for server-to-server fetches. */
  internalServerUrl?: string;
  /** Server-local Plex account id cached at auth time for session filtering. */
  plexAccountId?: string;
}

interface PlexGlobalCfg {}

interface PlexSharedCreds {}

type Ctx = PluginContext<PlexCreds, PlexSharedCreds, PlexUserCfg, PlexGlobalCfg>;

// ─── Client identity ────────────────────────────────────────────────────────

// Stable client identity used on every Plex API call. Plex ties PIN approval to
// the clientIdentifier that created it, so the value MUST be deterministic
// across `startAuth` and `pollAuth` within the same deployment — otherwise the
// token Plex issues cannot be used by other callers. Versioning the identifier
// lets us rotate (e.g. on a breaking change to how we format the product name)
// without stranding existing connections.
const PLEX_CLIENT_IDENTIFIER = "media-manager-v1";
const PLEX_PRODUCT = "Media Manager";
const PLEX_DEVICE = "Media Manager";
const PLEX_VERSION = "1.0.0";
const PLEX_PLATFORM = "Web";

const PLEX_TV_BASE = "https://plex.tv/api/v2";

function plexTvHeaders(accept: "json" | "xml" = "json"): Record<string, string> {
  return {
    Accept: accept === "json" ? "application/json" : "application/xml",
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER,
    "X-Plex-Device": PLEX_DEVICE,
    "X-Plex-Version": PLEX_VERSION,
    "X-Plex-Platform": PLEX_PLATFORM,
  };
}

function serverHeaders(ctx: Ctx): Record<string, string> {
  const token = ctx.credentials?.authToken;
  if (!token) {
    throw pluginError("plugin.token_expired", "Plex auth token missing — please reconnect");
  }
  return {
    Accept: "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER,
  };
}

// ─── URL helpers ────────────────────────────────────────────────────────────

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function readUserConfig(ctx: Ctx): PlexUserCfg {
  const cfg = ctx.config?.user;
  if (!cfg) {
    throw pluginError("plugin.bad_credentials", "Plex connection config missing");
  }
  return cfg;
}

/**
 * URL base used by the host for outbound server-to-server calls. Falls back to
 * the external URL when the admin has not configured an internal one — a
 * self-hosted deployment without a docker-network shortcut still works, it
 * just routes through the public URL.
 */
function pickFetchBase(cfg: PlexUserCfg): string {
  const base = cfg.internalServerUrl ?? cfg.externalServerUrl;
  if (!base) {
    throw pluginError(
      "plugin.bad_credentials",
      "Plex externalServerUrl not configured on connection",
    );
  }
  return stripTrailingSlash(base);
}

/**
 * URL base used to build outward-facing links (playerLink / webLink). Always
 * the external URL — never the internal/docker one — because the link is
 * consumed by the caller's browser, not the host.
 */
function externalBase(cfg: PlexUserCfg): string {
  if (!cfg.externalServerUrl) {
    throw pluginError(
      "plugin.bad_credentials",
      "Plex externalServerUrl not configured on connection",
    );
  }
  return stripTrailingSlash(cfg.externalServerUrl);
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

async function plexServerFetch(ctx: Ctx, path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = readUserConfig(ctx);
  const url = `${pickFetchBase(cfg)}${path}`;
  const headers = { ...serverHeaders(ctx), ...(init.headers as Record<string, string>) };
  return ctx.fetch(url, { ...init, headers });
}

async function plexServerJson<T>(ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await plexServerFetch(ctx, path, init);
  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get("Retry-After") ?? 0) || undefined;
    ctx.pool.markExhausted({ retryAfterSec });
    throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
  }
  handleHttpStatus(res, "Plex", { on401: "plugin.token_expired" });
  if (!res.ok) {
    throw pluginError("plugin.upstream_error", `Plex ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ─── Plex server payload shapes ─────────────────────────────────────────────

interface PlexMediaContainer<T> {
  MediaContainer: T;
}

interface PlexGuid {
  id: string;
}

interface PlexPart {
  id: number;
  size?: number;
  container?: string;
  file?: string;
}

interface PlexMedia {
  id?: number;
  videoResolution?: string;
  videoCodec?: string;
  bitrate?: number;
  videoDynamicRange?: string;
  Part?: PlexPart[];
}

interface PlexMetadata {
  ratingKey: string;
  key: string;
  type: string;
  title: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  librarySectionID?: number;
  Media?: PlexMedia[];
  Guid?: PlexGuid[];
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  lastViewedAt?: number;
  viewCount?: number;
  User?: { id: string; title?: string };
}

interface PlexDirectory {
  key: string;
  title: string;
  type: string;
}

interface PlexSession extends PlexMetadata {
  sessionKey?: string;
  Session?: { id: string };
  Player?: {
    title?: string;
    product?: string;
    state?: string;
  };
  User: { id: string; title?: string };
  TranscodeSession?: {
    videoDecision?: string;
    audioDecision?: string;
    targetBitrate?: number;
    transcodeReason?: string;
    throttled?: boolean;
  };
}

// ─── Mapping helpers ────────────────────────────────────────────────────────

const RESOLUTION_MAP: Record<string, LibraryItem["quality"]["resolution"]> = {
  "4k": "4k",
  "2160": "4k",
  "1080": "1080p",
  "720": "720p",
  "480": "sd",
  sd: "sd",
};

function mapResolution(raw: string | undefined): LibraryItem["quality"]["resolution"] {
  if (!raw) return undefined;
  const key = raw.toLowerCase();
  return RESOLUTION_MAP[key] ?? undefined;
}

function mapHdr(raw: string | undefined): LibraryItem["quality"]["hdr"] {
  if (!raw) return undefined;
  const key = raw.toLowerCase();
  if (key.includes("dolby")) return "dolby-vision";
  if (key.includes("hdr10")) return "hdr10";
  if (key.includes("hlg")) return "hlg";
  if (key === "sdr") return "none";
  return undefined;
}

function itemType(raw: string): LibraryItem["type"] {
  if (raw === "movie") return "movie";
  if (raw === "episode") return "episode";
  return "show";
}

function buildPlayerLink(cfg: PlexUserCfg, ratingKey: string): string {
  // Plex's cross-client deep-link format. Encodes the server and item so the
  // caller's native app opens the right thing without a round-trip through
  // plex.tv. The server URL MUST be the external one.
  const server = encodeURIComponent(externalBase(cfg));
  return `plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F${ratingKey}&server=${server}`;
}

function buildWebLink(cfg: PlexUserCfg, ratingKey: string): string {
  const base = externalBase(cfg);
  const metadataKey = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `${base}/web/index.html#!/server/${cfg.machineIdentifier}/details?key=${metadataKey}`;
}

function toLibraryItem(cfg: PlexUserCfg, m: PlexMetadata): LibraryItem {
  const firstMedia = m.Media?.[0];
  const firstPart = firstMedia?.Part?.[0];
  const quality = {
    resolution: mapResolution(firstMedia?.videoResolution),
    codec: firstMedia?.videoCodec,
    hdr: mapHdr(firstMedia?.videoDynamicRange),
    bitrate: firstMedia?.bitrate,
  };
  return {
    id: m.ratingKey,
    title: m.type === "episode" ? (m.grandparentTitle ?? m.title) : m.title,
    type: itemType(m.type),
    season: m.parentIndex,
    episode: m.index,
    quality,
    playerLink: buildPlayerLink(cfg, m.ratingKey),
    webLink: buildWebLink(cfg, m.ratingKey),
    sizeBytes: firstPart?.size,
    durationSec: m.duration ? Math.round(m.duration / 1000) : undefined,
    addedAt: m.addedAt ? new Date(m.addedAt * 1000).toISOString() : new Date(0).toISOString(),
  };
}

// ─── Guid parsing for idResolve ─────────────────────────────────────────────

function parseGuids(guids: PlexGuid[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of guids ?? []) {
    const m = /^(tmdb|imdb|tvdb):\/\/(.+)$/.exec(g.id);
    if (!m) continue;
    out[m[1]!] = m[2]!;
  }
  return out;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export default definePlugin({
  manifest: {
    id: "plex",
    name: "Plex",
    version: "1.0.0",
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

  // ─── Auth ───────────────────────────────────────────────────────────────

  async startAuth(ctx, _input): Promise<AuthResult> {
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
  },

  async pollAuth(ctx, pollState): Promise<AuthResult> {
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
      // Non-fatal; session filtering degrades gracefully if the account id is
      // unknown (see getSessions).
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
          provides: string;
          owned?: boolean;
          name?: string;
        }>;
        const owned = resources.find((r) => r.provides?.includes("server") && (r.owned ?? true));
        const firstServer = owned ?? resources.find((r) => r.provides?.includes("server"));
        if (firstServer) {
          userConfigPatch["machineIdentifier"] = firstServer.clientIdentifier;
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
  },

  async testConnection(ctx) {
    try {
      const res = await plexServerFetch(ctx as Ctx, "/identity");
      if (res.status === 401) return { ok: false, message: "Plex token invalid or expired" };
      if (!res.ok) return { ok: false, message: `Plex ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  // ─── Capabilities ───────────────────────────────────────────────────────

  capabilities: {
    libraryAvailability: {
      async checkAvailability(ctx, input) {
        const {
          id,
          idType,
          type: _type,
        } = input as {
          id: string;
          idType: "tmdb" | "imdb" | "tvdb" | "plex" | "jellyfin";
          type: "movie" | "show";
        };
        const cfg = readUserConfig(ctx as Ctx);

        if (idType === "jellyfin") {
          // Plex cannot resolve Jellyfin-local ids. Surface as "no matches"
          // rather than an error — callers fan out across media-server
          // plugins and should see each one's independent view.
          return { items: [] };
        }

        let path: string;
        if (idType === "plex") {
          path = `/library/metadata/${encodeURIComponent(id)}`;
        } else {
          // Plex indexes items by their Guid entries (`tmdb://`, `imdb://`,
          // `tvdb://`); /library/all?guid=... returns matching items across
          // every section the token can see.
          const guid = `${idType}://${id}`;
          path = `/library/all?guid=${encodeURIComponent(guid)}`;
        }

        try {
          const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
            ctx as Ctx,
            path,
          );
          const metadata = body.MediaContainer?.Metadata ?? [];
          return { items: metadata.map((m) => toLibraryItem(cfg, m)) };
        } catch (err) {
          // A 404 from /library/metadata means the ratingKey is not in the
          // library; treat as "no matches" to match the capability contract.
          if (
            err &&
            typeof err === "object" &&
            (err as { code?: string }).code === "plugin.item_not_found"
          ) {
            return { items: [] };
          }
          throw err;
        }
      },

      async listRecentlyAdded(ctx, input) {
        const { limit = 50, cursor } = input as {
          type?: "movie" | "show";
          limit?: number;
          cursor?: string;
        };
        const cfg = readUserConfig(ctx as Ctx);
        const start = cursor ? parseInt(cursor, 10) : 0;
        if (Number.isNaN(start) || start < 0) {
          throw pluginError("plugin.input_invalid", "Plex cursor must be a non-negative integer");
        }
        const params = new URLSearchParams({
          "X-Plex-Container-Start": String(start),
          "X-Plex-Container-Size": String(limit),
        });
        const body = await plexServerJson<
          PlexMediaContainer<{
            Metadata?: PlexMetadata[];
            totalSize?: number;
            size?: number;
          }>
        >(ctx as Ctx, `/library/recentlyAdded?${params.toString()}`);
        const metadata = body.MediaContainer?.Metadata ?? [];
        const items = metadata.map((m) => toLibraryItem(cfg, m));
        const totalSize = body.MediaContainer?.totalSize ?? items.length;
        const returned = body.MediaContainer?.size ?? items.length;
        const next = start + returned;
        return {
          items,
          nextCursor: next < totalSize ? String(next) : undefined,
        };
      },

      async searchLibrary(ctx, input) {
        const { query, type } = input as {
          query: string;
          type?: "movie" | "show";
          limit?: number;
        };
        const cfg = readUserConfig(ctx as Ctx);
        const params = new URLSearchParams({ query });
        if (type === "movie") params.set("type", "1");
        else if (type === "show") params.set("type", "2");
        const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
          ctx as Ctx,
          `/search?${params.toString()}`,
        );
        const metadata = body.MediaContainer?.Metadata ?? [];
        return metadata.map((m) => toLibraryItem(cfg, m));
      },
    },

    playback: {
      async getPositions(ctx, input) {
        const { type } = input as { type?: "movie" | "tv" };
        const cfg = readUserConfig(ctx as Ctx);
        const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
          ctx as Ctx,
          "/library/onDeck",
        );
        const metadata = body.MediaContainer?.Metadata ?? [];
        const results = [];
        for (const m of metadata) {
          if (type === "movie" && m.type !== "movie") continue;
          if (type === "tv" && m.type !== "episode" && m.type !== "show") continue;
          const duration = m.duration ?? 0;
          const offset = m.viewOffset ?? 0;
          const progress = duration > 0 ? Math.min(100, Math.round((offset / duration) * 100)) : 0;
          const pausedAt = m.lastViewedAt
            ? new Date(m.lastViewedAt * 1000).toISOString()
            : new Date(0).toISOString();
          results.push({
            item: toItemShape(cfg, m),
            progress,
            pausedAt,
            season: m.parentIndex,
            episode: m.index,
            playbackId: m.ratingKey,
          });
        }
        return results;
      },

      async removePosition(ctx, input) {
        const { playbackId } = input as { playbackId: string };
        // Plex exposes "forget the current offset" via /:/unscrobble with the
        // item's ratingKey. 200/204 both mean success; 404 means the item is
        // unknown (already cleared) — treat as idempotent.
        const params = new URLSearchParams({
          identifier: "com.plexapp.plugins.library",
          key: playbackId,
        });
        const res = await plexServerFetch(ctx as Ctx, `/:/unscrobble?${params.toString()}`);
        if (res.status === 401)
          throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
        if (res.status === 429) throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
        if (res.status >= 500)
          throw pluginError("plugin.upstream_error", `Plex server error (${res.status})`);
        return { ok: res.ok || res.status === 404 };
      },
    },

    playbackSessions: {
      async getSessions(ctx, _input) {
        const cfg = readUserConfig(ctx as Ctx);
        const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexSession[] }>>(
          ctx as Ctx,
          "/status/sessions",
        );
        const sessions = body.MediaContainer?.Metadata ?? [];
        const out = [];
        for (const s of sessions) {
          // Privacy guarantee: drop sessions whose User.id does not match the
          // connection's own account id, even if the Plex token could technically
          // see them. `plexAccountId` is cached at auth time — if it's missing
          // (older connections, auth that could not reach /user), keep the
          // session since we cannot verify ownership and stripping everything
          // would make the capability unusable for those users.
          if (cfg.plexAccountId && s.User?.id && String(s.User.id) !== cfg.plexAccountId) {
            continue;
          }
          const sessionId = s.Session?.id ?? s.sessionKey;
          if (!sessionId) continue;
          out.push({
            sessionId: String(sessionId),
            deviceName: s.Player?.title ?? "unknown",
            clientName: s.Player?.product,
            user: {
              id: String(s.User?.id ?? ""),
              name: s.User?.title ?? "",
            },
            item: toLibraryItem(cfg, s),
            progressMs: s.viewOffset ?? 0,
            durationMs: s.duration ?? 0,
            state: normalizeSessionState(s.Player?.state),
            transcoding: s.TranscodeSession
              ? {
                  videoDecision: normalizeDecision(s.TranscodeSession.videoDecision),
                  audioDecision: normalizeDecision(s.TranscodeSession.audioDecision),
                  targetBitrate: s.TranscodeSession.targetBitrate,
                  reason: s.TranscodeSession.transcodeReason,
                }
              : undefined,
            startedAt: new Date(0).toISOString(),
          });
        }
        return out;
      },

      async stopSession(ctx, input) {
        const { sessionId, reason } = input as { sessionId: string; reason?: string };
        const params = new URLSearchParams({ sessionId });
        if (reason) params.set("reason", reason);
        const res = await plexServerFetch(
          ctx as Ctx,
          `/status/sessions/terminate?${params.toString()}`,
          { method: "DELETE" },
        );
        if (res.status === 401)
          throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
        if (res.status === 429) throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
        if (res.status >= 500)
          throw pluginError("plugin.upstream_error", `Plex server error (${res.status})`);
        // 404 means the session already ended; treat as idempotent success so
        // a double-click on "stop" does not surface a spurious failure.
        return { ok: res.ok || res.status === 404, semantics: "forced" as const };
      },
    },

    continueWatching: {
      async getContinueWatching(ctx, input) {
        const { type, limit = 50 } = input as {
          type?: "movie" | "show";
          limit?: number;
        };
        const cfg = readUserConfig(ctx as Ctx);
        const params = new URLSearchParams({
          contentDirectoryID: "1",
          "X-Plex-Container-Start": "0",
          "X-Plex-Container-Size": String(limit),
        });

        // Prefer the modern hub, but older Plex servers (<=1.20) don't expose
        // it — fall back to /library/onDeck which covers the same rows at a
        // coarser granularity.
        let metadata: PlexMetadata[] = [];
        try {
          const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
            ctx as Ctx,
            `/hubs/continueWatching?${params.toString()}`,
          );
          metadata = body.MediaContainer?.Metadata ?? [];
        } catch (err) {
          if (
            err &&
            typeof err === "object" &&
            (err as { code?: string }).code === "plugin.item_not_found"
          ) {
            const fallback = await plexServerJson<
              PlexMediaContainer<{ Metadata?: PlexMetadata[] }>
            >(ctx as Ctx, "/library/onDeck");
            metadata = fallback.MediaContainer?.Metadata ?? [];
          } else {
            throw err;
          }
        }

        const out = [];
        for (const m of metadata) {
          if (type === "movie" && m.type !== "movie") continue;
          if (type === "show" && m.type !== "episode" && m.type !== "show") continue;
          const entry: {
            item: LibraryItem;
            progressMs?: number;
            lastPlayedAt?: string;
          } = {
            item: toLibraryItem(cfg, m),
            progressMs: typeof m.viewOffset === "number" ? m.viewOffset : undefined,
            lastPlayedAt: m.lastViewedAt
              ? new Date(m.lastViewedAt * 1000).toISOString()
              : undefined,
          };
          out.push(entry);
        }
        return out;
      },
    },

    watchHistory: {
      async getHistory(ctx, input) {
        const { since } = input as { since?: string };
        const cfg = readUserConfig(ctx as Ctx);
        const params = new URLSearchParams();
        if (cfg.plexAccountId) params.set("accountID", cfg.plexAccountId);
        if (since) {
          const t = Math.floor(new Date(since).getTime() / 1000);
          if (!Number.isNaN(t)) params.set("viewedAt>", String(t));
        }
        const query = params.toString();
        const path = query
          ? `/status/sessions/history/all?${query}`
          : "/status/sessions/history/all";
        const body = await plexServerJson<
          PlexMediaContainer<{
            Metadata?: Array<PlexMetadata & { viewedAt?: number }>;
          }>
        >(ctx as Ctx, path);
        const rows = body.MediaContainer?.Metadata ?? [];
        return rows.map((r) => ({
          item: toItemShape(cfg, r),
          watchedAt: r.viewedAt ? new Date(r.viewedAt * 1000).toISOString() : "",
          progress: 100,
        }));
      },

      async addToHistory(ctx, input) {
        const items = input as Array<{
          id?: string;
          ids?: { plex_ratingKey?: string };
          type: string;
        }>;
        let added = 0;
        for (const item of items) {
          const ratingKey = extractRatingKey(item);
          if (!ratingKey) continue;
          const params = new URLSearchParams({
            identifier: "com.plexapp.plugins.library",
            key: ratingKey,
          });
          const res = await plexServerFetch(ctx as Ctx, `/:/scrobble?${params.toString()}`);
          if (res.status === 401)
            throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
          if (res.status === 429)
            throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
          if (res.ok || res.status === 404) added += 1;
        }
        return { added };
      },

      async removeFromHistory(ctx, input) {
        const items = input as Array<{
          id?: string;
          ids?: { plex_ratingKey?: string };
          type: string;
        }>;
        let removed = 0;
        for (const item of items) {
          const ratingKey = extractRatingKey(item);
          if (!ratingKey) continue;
          const params = new URLSearchParams({
            identifier: "com.plexapp.plugins.library",
            key: ratingKey,
          });
          const res = await plexServerFetch(ctx as Ctx, `/:/unscrobble?${params.toString()}`);
          if (res.status === 401)
            throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
          if (res.status === 429)
            throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
          if (res.ok || res.status === 404) removed += 1;
        }
        return { removed };
      },
    },

    libraryAdmin: {
      async refreshLibrary(ctx, input) {
        const { librarySectionId } = input as { librarySectionId?: string };
        if (librarySectionId) {
          const res = await plexServerFetch(
            ctx as Ctx,
            `/library/sections/${encodeURIComponent(librarySectionId)}/refresh`,
          );
          if (res.status === 401)
            throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
          if (res.status === 429)
            throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
          return { ok: res.ok };
        }
        // No section id: enumerate every section and kick a force=1 refresh on
        // each. Plex itself has no server-wide "refresh everything" endpoint.
        const body = await plexServerJson<PlexMediaContainer<{ Directory?: PlexDirectory[] }>>(
          ctx as Ctx,
          "/library/sections",
        );
        const sections = body.MediaContainer?.Directory ?? [];
        if (sections.length === 0) return { ok: true };
        const results = await Promise.all(
          sections.map((s) =>
            plexServerFetch(
              ctx as Ctx,
              `/library/sections/${encodeURIComponent(s.key)}/refresh?force=1`,
            ),
          ),
        );
        return { ok: results.every((r) => r.ok) };
      },

      async refreshItem(ctx, input) {
        const { serverItemId } = input as { serverItemId: string };
        const res = await plexServerFetch(
          ctx as Ctx,
          `/library/metadata/${encodeURIComponent(serverItemId)}/refresh`,
          { method: "PUT" },
        );
        if (res.status === 401)
          throw pluginError("plugin.token_expired", "Plex auth rejected (401)");
        if (res.status === 429) throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
        return { ok: res.ok };
      },
    },

    idResolve: {
      async resolve(ctx, input) {
        const {
          from,
          id,
          type: _type,
        } = input as {
          from: "tmdb" | "tvdb" | "trakt" | "imdb" | "plex:ratingKey" | "jellyfin:itemId";
          id: string;
          type: "movie" | "tv";
        };
        // Plex has no anchor for Jellyfin-local ids, and Trakt ids are not
        // indexed on the server side — both fall through as empty.
        if (from === "jellyfin:itemId" || from === "trakt") return {};

        // A Plex-local ratingKey lookup hits /library/metadata/{id} directly;
        // everything else goes through /library/all?guid=... which indexes by
        // the Guid entries on library items.
        let first: PlexMetadata | undefined;
        if (from === "plex:ratingKey") {
          try {
            const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
              ctx as Ctx,
              `/library/metadata/${encodeURIComponent(id)}`,
            );
            first = body.MediaContainer?.Metadata?.[0];
          } catch (err) {
            if (
              err &&
              typeof err === "object" &&
              (err as { code?: string }).code === "plugin.item_not_found"
            ) {
              return {};
            }
            throw err;
          }
        } else {
          const guid = `${from}://${id}`;
          const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
            ctx as Ctx,
            `/library/all?guid=${encodeURIComponent(guid)}`,
          );
          first = body.MediaContainer?.Metadata?.[0];
        }
        if (!first) return {};
        const guids = parseGuids(first.Guid);
        const out: Record<string, string> = { "plex:ratingKey": first.ratingKey };
        if (guids["tmdb"]) out["tmdb"] = guids["tmdb"]!;
        if (guids["imdb"]) out["imdb"] = guids["imdb"]!;
        if (guids["tvdb"]) out["tvdb"] = guids["tvdb"]!;
        return out;
      },
    },
  },
});

// ─── Local helpers used by capability implementations above ─────────────────

/**
 * Shapes a Plex metadata row as a cross-service `MediaItem` (the shape used by
 * `playback@v1` and `watchHistory@v1`). Distinct from `toLibraryItem`, which
 * emits the server-local `LibraryItem` shape — the two capabilities have
 * different schemas and a single mapper would obscure the difference.
 *
 * `cfg` is intentionally kept on the signature even though the current body
 * only uses its ratingKey output — future enrichment (e.g. per-item poster
 * URLs built off `externalBase(cfg)`) should land without rethreading call
 * sites.
 */
function toItemShape(
  _cfg: PlexUserCfg,
  m: PlexMetadata,
): {
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "tv";
  genres: string[];
  rating: number | null;
  overview: string;
  posterUrl: string | null;
  ids: Record<string, string>;
} {
  const guids = parseGuids(m.Guid);
  const ids: Record<string, string> = { plex_ratingKey: m.ratingKey };
  if (guids["tmdb"]) ids["tmdb_id"] = guids["tmdb"]!;
  if (guids["imdb"]) ids["imdb_id"] = guids["imdb"]!;
  if (guids["tvdb"]) ids["tvdb_id"] = guids["tvdb"]!;
  // Collapse Plex-local types to the cross-service catalog types: "show" and
  // "episode" both render as "tv"; "movie" stays as-is.
  const castType: "movie" | "tv" = m.type === "movie" ? "movie" : "tv";
  return {
    id: `${castType}:${guids["tmdb"] ?? m.ratingKey}`,
    title: m.type === "episode" ? (m.grandparentTitle ?? m.title) : m.title,
    year: null,
    type: castType,
    genres: [],
    rating: null,
    overview: "",
    posterUrl: null,
    ids,
  };
}

function normalizeSessionState(raw: string | undefined): "playing" | "paused" | "buffering" {
  if (raw === "paused") return "paused";
  if (raw === "buffering") return "buffering";
  return "playing";
}

function normalizeDecision(raw: string | undefined): "direct-play" | "copy" | "transcode" {
  if (raw === "copy") return "copy";
  if (raw === "transcode") return "transcode";
  return "direct-play";
}

/**
 * Pulls a Plex ratingKey off a media item. Prefers the explicit
 * `ids.plex_ratingKey` hint used by the id-map; falls back to the `id` field
 * when it looks like a bare Plex ratingKey (digits only). Returns null when
 * the caller has only a cross-service id — they need to route through the
 * plugin's own `idResolve` first (tracked by #29 for the host wiring).
 */
function extractRatingKey(item: { id?: string; ids?: { plex_ratingKey?: string } }): string | null {
  if (item.ids?.plex_ratingKey) return item.ids.plex_ratingKey;
  if (item.id && /^\d+$/.test(item.id)) return item.id;
  return null;
}

import type { LibraryItem } from "@ent-mcp/shared/plugins/library";
import { definePlugin } from "../../../plugin-runtime/define";
import type { AuthResult, PluginContext } from "../../../plugin-runtime/types";
import { pluginError, toErrorMessage } from "../../utils/plugin-error";
import { handleHttpStatus } from "../../utils/http-status";

// ─── Config / credentials shapes ─────────────────────────────────────────────

interface JellyfinCreds {
  accessToken: string;
  /**
   * The user-submitted Jellyfin password, kept in the encrypted credentials
   * blob so that it never hits the plaintext `userConfig` column. Needed on
   * re-auth to exchange for a fresh access token after the cached one expires.
   */
  password: string;
}

// Pure user-scoped plugin — no `sharedCredentialsSchema` declared.
interface JellyfinSharedCreds {}

interface JellyfinUserCfg {
  /** Public URL the client can reach. Used for every playerLink / webLink. */
  externalServerUrl: string;
  /**
   * Optional private URL used for server-to-server `ctx.fetch`. Falls back to
   * `externalServerUrl` when unset. Marked `x-private` so it never leaves the
   * server in a connection list/get response.
   */
  internalServerUrl?: string;
  username: string;
  /** Resolved + cached by `startAuth` via `/Users/Me`. Non-editable. */
  userId?: string;
}

interface JellyfinGlobalCfg {}

type Ctx = PluginContext<JellyfinCreds, JellyfinSharedCreds, JellyfinUserCfg, JellyfinGlobalCfg>;

/**
 * Cross-service media item shape returned by capabilities like `playback@v1`
 * and `watchHistory@v1` — distinct from the richer server-local `LibraryItem`
 * that leaks Jellyfin-only fields. Kept at file scope so the two emitters
 * (`getPositions` and `getHistory`) cannot drift.
 */
interface MediaItemShape {
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "tv";
  genres: string[];
  rating: null;
  overview: string;
  posterUrl: null;
  ids: Record<string, string | undefined>;
}

// Stable client identity sent to Jellyfin on every request. Jellyfin uses this
// to attribute sessions + log-in audits; keeping it constant makes it easier
// for admins to recognise media-manager-originated traffic.
const CLIENT_NAME = "media-manager";
const CLIENT_VERSION = "1.0.0";
const DEVICE_NAME = "media-manager";
// Per-connection device id would be ideal, but Jellyfin happily accepts a
// stable string — the deviceId only matters for uniqueness among active
// sessions the server shows to admins. Using the plugin name keeps the
// plugin deterministic and matches what Jellyfin Web ships.
const DEVICE_ID = "media-manager";

// ─── URL helpers ─────────────────────────────────────────────────────────────

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function getUserCfg(ctx: Ctx): JellyfinUserCfg {
  const cfg = ctx.config.user;
  if (!cfg?.externalServerUrl) {
    throw pluginError("plugin.bad_credentials", "Jellyfin externalServerUrl not configured");
  }
  return cfg;
}

/**
 * Picks the base URL the plugin should use for server-to-server `ctx.fetch`.
 * Prefers `internalServerUrl` (e.g. `http://jellyfin:8096` inside docker);
 * falls back to `externalServerUrl` when the admin has not configured an
 * internal URL. Public links (playerLink / webLink) always use the external
 * URL — see `getExternalBase`.
 */
function pickFetchBase(userConfig: JellyfinUserCfg): string {
  return trimSlash(userConfig.internalServerUrl?.trim() || userConfig.externalServerUrl);
}

function getExternalBase(userConfig: JellyfinUserCfg): string {
  return trimSlash(userConfig.externalServerUrl);
}

function getAccessToken(ctx: Ctx): string {
  const token = ctx.credentials?.accessToken;
  if (!token) {
    throw pluginError("plugin.token_expired", "Jellyfin session missing — please reconnect");
  }
  return token;
}

function getUserId(ctx: Ctx): string {
  const id = ctx.config.user?.userId;
  if (!id) {
    // Re-auth is the only way to repopulate this — the client cannot send it
    // through the edit form since the field is non-editable.
    throw pluginError(
      "plugin.token_expired",
      "Jellyfin userId not cached — please reconnect to refresh the connection",
    );
  }
  return id;
}

function authHeader(token: string): Record<string, string> {
  // Jellyfin accepts both `X-Emby-Token` and the verbose `Authorization:
  // MediaBrowser …` header. The verbose form carries client/device metadata
  // so admin UIs can label the session; we send both to keep old servers
  // (which only honour X-Emby-Token) happy too.
  //
  // Strip characters that would terminate a quoted `"…"` header value or
  // inject a new header: an adversarial server that returned a token
  // containing `"`, CR, or LF would otherwise corrupt the Authorization
  // header. Jellyfin tokens are opaque random strings in practice, so this
  // is defence-in-depth rather than known-exploitable.
  const safeToken = token.replace(/["\r\n]/g, "");
  return {
    "X-Emby-Token": safeToken,
    Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}", Token="${safeToken}"`,
  };
}

async function jellyfinFetch(ctx: Ctx, path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = getUserCfg(ctx);
  const base = pickFetchBase(cfg);
  const token = getAccessToken(ctx);
  const headers = {
    accept: "application/json",
    ...authHeader(token),
    ...(init.headers as Record<string, string> | undefined),
  };
  return ctx.fetch(`${base}${path}`, { ...init, headers });
}

async function jellyfinJson<T>(ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await jellyfinFetch(ctx, path, init);
  handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
  if (!res.ok) {
    throw pluginError("plugin.upstream_error", `Jellyfin ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// Fire-and-forget POST: returns only whether Jellyfin accepted the request.
// 401/429/5xx translate through `handleHttpStatus` so the host can refresh
// tokens / back off.
async function jellyfinFireAndForget(ctx: Ctx, path: string): Promise<{ ok: boolean }> {
  const res = await jellyfinFetch(ctx, path, { method: "POST" });
  handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
  return { ok: res.ok };
}

// ─── Jellyfin response types (minimal, only fields we consume) ───────────────

interface JellyfinProviderIds {
  Imdb?: string;
  Tmdb?: string;
  Tvdb?: string;
}

interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string; // "Movie" | "Series" | "Episode" | ...
  ParentIndexNumber?: number; // season for episodes
  IndexNumber?: number; // episode number
  ProductionYear?: number;
  RunTimeTicks?: number; // 10,000,000 ticks per second
  DateCreated?: string;
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
    LastPlayedDate?: string;
    Played?: boolean;
  };
  MediaSources?: Array<{
    Size?: number;
    Bitrate?: number;
    MediaStreams?: Array<{
      Type: string; // "Video" | "Audio" | "Subtitle"
      Codec?: string;
      Width?: number;
      Height?: number;
      VideoRange?: string; // "SDR" | "HDR"
      VideoRangeType?: string; // "SDR" | "HDR10" | "DOVI" | "HLG" | ...
    }>;
  }>;
  ProviderIds?: JellyfinProviderIds;
}

interface JellyfinSession {
  Id: string;
  UserId?: string;
  UserName?: string;
  DeviceName?: string;
  Client?: string;
  NowPlayingItem?: JellyfinItem;
  PlayState?: {
    PositionTicks?: number;
    IsPaused?: boolean;
    PlayMethod?: string; // "DirectPlay" | "DirectStream" | "Transcode"
  };
  TranscodingInfo?: {
    VideoCodec?: string;
    AudioCodec?: string;
    Bitrate?: number;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    TranscodeReasons?: string[];
  };
  PlayDuration?: number; // ms since session started (not always present)
  StartTimeUtc?: string;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

const TICKS_PER_SECOND = 10_000_000;

function ticksToMs(ticks: number | undefined): number {
  return Math.floor((ticks ?? 0) / 10_000);
}

function ticksToSeconds(ticks: number | undefined): number | undefined {
  if (!ticks) return undefined;
  return Math.floor(ticks / TICKS_PER_SECOND);
}

function mapItemType(jfType: string): "movie" | "show" | "episode" | null {
  switch (jfType) {
    case "Movie":
      return "movie";
    case "Series":
      return "show";
    case "Episode":
      return "episode";
    default:
      return null;
  }
}

// Collapses Jellyfin's `VideoRangeType` / `VideoRange` into the capability's
// four HDR buckets. Missing / unknown values map to `"none"` so the caller
// doesn't have to distinguish "explicitly SDR" from "unknown". Anything not
// recognised as HDR or Dolby Vision is treated as SDR.
function mapHdr(
  range: string | undefined,
  rangeType: string | undefined,
): "hdr10" | "dolby-vision" | "hlg" | "none" | undefined {
  const rt = rangeType?.toLowerCase() ?? "";
  if (rt.includes("dovi") || rt.includes("dolby")) return "dolby-vision";
  if (rt === "hdr10" || rt === "hdr10plus" || rt === "hdr") return "hdr10";
  if (rt === "hlg") return "hlg";
  if ((range ?? "").toLowerCase() === "hdr") return "hdr10";
  return "none";
}

function mapResolution(
  width: number | undefined,
  height: number | undefined,
): "4k" | "1080p" | "720p" | "sd" | undefined {
  const h = height ?? 0;
  const w = width ?? 0;
  if (h >= 2000 || w >= 3000) return "4k";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h > 0) return "sd";
  return undefined;
}

// Jellyfin official clients open the web UI directly — there is no
// registered custom scheme on most platforms. `#!/details?id=…` is what
// `jellyfin-web` itself routes to, so passing it through the configured
// external URL lands the caller on the same detail view. `playerLink` and
// `webLink` currently share this URL; kept as a single helper until a
// platform-specific scheme (e.g. mobile app deep link) is wired.
function buildItemUrl(externalBase: string, itemId: string): string {
  return `${externalBase}/web/index.html#!/details?id=${encodeURIComponent(itemId)}`;
}

function mapQuality(item: JellyfinItem): LibraryItem["quality"] {
  const videoStream = item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === "Video");
  const source = item.MediaSources?.[0];
  const quality: LibraryItem["quality"] = {};
  const resolution = mapResolution(videoStream?.Width, videoStream?.Height);
  if (resolution) quality.resolution = resolution;
  if (videoStream?.Codec) quality.codec = videoStream.Codec;
  const hdr = mapHdr(videoStream?.VideoRange, videoStream?.VideoRangeType);
  if (hdr) quality.hdr = hdr;
  if (source?.Bitrate) quality.bitrate = Math.round(source.Bitrate / 1000);
  return quality;
}

function mapLibraryItem(item: JellyfinItem, externalBase: string): LibraryItem | null {
  const type = mapItemType(item.Type);
  if (!type) return null;
  const entry: LibraryItem = {
    id: item.Id,
    title: item.Name,
    type,
    quality: mapQuality(item),
    playerLink: buildItemUrl(externalBase, item.Id),
    webLink: buildItemUrl(externalBase, item.Id),
    addedAt: item.DateCreated ?? new Date(0).toISOString(),
  };
  if (type === "episode") {
    if (typeof item.ParentIndexNumber === "number") entry.season = item.ParentIndexNumber;
    if (typeof item.IndexNumber === "number") entry.episode = item.IndexNumber;
  }
  const size = item.MediaSources?.[0]?.Size;
  if (typeof size === "number") entry.sizeBytes = size;
  const durationSec = ticksToSeconds(item.RunTimeTicks);
  if (durationSec) entry.durationSec = durationSec;
  return entry;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default definePlugin({
  manifest: {
    id: "jellyfin",
    name: "Jellyfin",
    version: "1.0.2",
    description:
      "Self-hosted Jellyfin server integration. Users sign in with their Jellyfin username and password; the plugin caches an access token and the resolved Jellyfin user id per connection.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    // No static hosts — every upstream is a user-supplied server URL.
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
      // `password` is required on initial create only — it is stripped from
      // persisted userConfig by startAuth's `userConfigPatch: { password: null }`
      // after being moved into the encrypted credentials blob, so re-auth
      // reads it from `ctx.credentials` rather than from userConfig.
      required: ["externalServerUrl", "username", "password"],
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
      // Declared `scope: "user"` per design. The dispatcher does not yet route
      // to user-scoped idResolve providers (tracked in #29); the implementation
      // becomes reachable automatically once that lands.
      idResolve: { version: "v1", scope: "user" },
    },
    // Jellyfin access tokens are per-user; there are no admin-owned shared
    // credentials to pool/rotate across users, so the shared-credentials pool
    // does not apply here.
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
    // On re-auth the form does not resubmit the password (it is not stored in
    // userConfig — the host-side plumbing keeps it in the encrypted credentials
    // blob). Fall back to the prior password the host rehydrates via
    // ctx.credentials so a userConfig edit doesn't require re-entering it.
    const priorCreds = ctx.credentials as JellyfinCreds | null;
    const password = cfg.password ?? priorCreds?.password;
    if (!cfg.username || !password) {
      return {
        status: "error",
        code: "plugin.input_invalid",
        devMessage: "username and password are required",
      };
    }

    // Prefer the internal URL for the auth round-trip. Falling back to the
    // external URL keeps single-URL deployments working.
    const base = pickFetchBase(cfg);

    const authRes = await ctx.fetch(`${base}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Jellyfin's auth endpoint requires the MediaBrowser Authorization
        // header even before we have a token.
        Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
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

    // Resolve the caller's Jellyfin user id so every subsequent capability
    // call can build `/Users/{userId}/...` routes without a round-trip.
    // `AuthenticateByName` usually returns `User.Id` inline; fall back to
    // `/Users/Me` only when the auth response omits it, so the cached userId
    // is always whatever the server says the current access token represents.
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
      // `password: null` strips the submitted password from the persisted
      // userConfig — it now lives in the encrypted credentials blob instead.
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
    libraryAvailability: {
      async checkAvailability(ctx, input) {
        const typedCtx = ctx as Ctx;
        const { id, idType, type } = input as {
          id: string;
          idType: "tmdb" | "imdb" | "tvdb" | "plex" | "jellyfin";
          type: "movie" | "show";
        };
        // Server-local id: hit the item endpoint directly.
        if (idType === "jellyfin") {
          try {
            const item = await jellyfinJson<JellyfinItem>(typedCtx, `/Items/${id}`);
            const entry = mapLibraryItem(item, getExternalBase(getUserCfg(typedCtx)));
            return { items: entry ? [entry] : [] };
          } catch (err) {
            // A missing server-local id is an empty result, not an error —
            // the caller's cached id may have been deleted upstream. Other
            // errors still surface.
            if (
              typeof err === "object" &&
              err !== null &&
              (err as { code?: string }).code === "plugin.item_not_found"
            ) {
              return { items: [] };
            }
            throw err;
          }
        }
        if (idType === "plex") {
          // Cross-server ids can't be resolved without going through a
          // metadata provider first, which is a deliberate callers'
          // responsibility per the capability design.
          return { items: [] };
        }
        const provider = idType === "tmdb" ? "Tmdb" : idType === "imdb" ? "Imdb" : "Tvdb";
        const jfType = type === "movie" ? "Movie" : "Series";
        const userId = getUserId(typedCtx);
        const params = new URLSearchParams({
          IncludeItemTypes: jfType,
          Recursive: "true",
          AnyProviderIdEquals: `${provider}.${id}`,
          Fields: "ProviderIds,MediaSources,DateCreated",
        });
        const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
          typedCtx,
          `/Users/${userId}/Items?${params.toString()}`,
        );
        const externalBase = getExternalBase(getUserCfg(typedCtx));
        const items = (data.Items ?? [])
          .map((row) => mapLibraryItem(row, externalBase))
          .filter((x): x is LibraryItem => x !== null);
        return { items };
      },

      async listRecentlyAdded(ctx, input) {
        const typedCtx = ctx as Ctx;
        const {
          type,
          limit = 20,
          cursor,
        } = input as {
          type?: "movie" | "show";
          limit?: number;
          cursor?: string;
        };
        const userId = getUserId(typedCtx);
        // Jellyfin's /Latest endpoint does not expose a cursor, but it accepts
        // a `Limit`. Callers paginate by asking for a bigger page — we treat
        // a passed cursor as the 1-based page index and translate.
        const page = cursor ? Math.max(parseInt(cursor, 10) || 1, 1) : 1;
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const params = new URLSearchParams({
          Limit: String(safeLimit * page),
          Fields: "ProviderIds,MediaSources,DateCreated",
        });
        if (type) params.set("IncludeItemTypes", type === "movie" ? "Movie" : "Series");
        const rows = await jellyfinJson<JellyfinItem[]>(
          typedCtx,
          `/Users/${userId}/Items/Latest?${params.toString()}`,
        );
        const slice = rows.slice((page - 1) * safeLimit, page * safeLimit);
        const externalBase = getExternalBase(getUserCfg(typedCtx));
        const items = slice
          .map((row) => mapLibraryItem(row, externalBase))
          .filter((x): x is LibraryItem => x !== null);
        const result: { items: LibraryItem[]; nextCursor?: string } = { items };
        if (rows.length > page * safeLimit) result.nextCursor = String(page + 1);
        return result;
      },

      async searchLibrary(ctx, input) {
        const typedCtx = ctx as Ctx;
        const {
          query,
          type,
          limit = 20,
        } = input as {
          query: string;
          type?: "movie" | "show";
          limit?: number;
        };
        const userId = getUserId(typedCtx);
        const params = new URLSearchParams({
          SearchTerm: query,
          Recursive: "true",
          Limit: String(Math.min(Math.max(limit, 1), 200)),
          Fields: "ProviderIds,MediaSources,DateCreated",
        });
        if (type) params.set("IncludeItemTypes", type === "movie" ? "Movie" : "Series");
        const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
          typedCtx,
          `/Users/${userId}/Items?${params.toString()}`,
        );
        const externalBase = getExternalBase(getUserCfg(typedCtx));
        return (data.Items ?? [])
          .map((row) => mapLibraryItem(row, externalBase))
          .filter((x): x is LibraryItem => x !== null);
      },
    },

    playback: {
      async getPositions(ctx, input) {
        const typedCtx = ctx as Ctx;
        const { type } = input as { type?: "movie" | "tv" };
        const userId = getUserId(typedCtx);
        const params = new URLSearchParams({
          Recursive: "true",
          Filters: "IsResumable",
          Fields: "ProviderIds,MediaSources,DateCreated,UserData",
        });
        if (type === "movie") params.set("IncludeItemTypes", "Movie");
        if (type === "tv") params.set("IncludeItemTypes", "Episode");
        const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
          typedCtx,
          `/Users/${userId}/Items?${params.toString()}`,
        );
        // `playback@v1` returns the cross-service `MediaItemShape` (not a
        // server-local `LibraryItem`), so we build the minimum set of fields
        // the capability schema requires and attach the Jellyfin item id as a
        // namespaced playbackId. `pausedAt` falls back to the epoch when the
        // server did not record a `LastPlayedDate` — the schema requires a
        // string, and an empty string would still validate but "epoch" reads
        // as "unknown" more honestly.
        const results: Array<{
          item: MediaItemShape;
          progress: number;
          pausedAt: string;
          season?: number;
          episode?: number;
          playbackId: string;
        }> = [];
        for (const row of data.Items ?? []) {
          // Episodes are the only "tv" form of resume; filter accordingly.
          const capType = row.Type === "Movie" ? "movie" : row.Type === "Episode" ? "tv" : null;
          if (!capType) continue;
          if (type && type !== capType) continue;
          const mediaItem: MediaItemShape = {
            id: `jellyfin:${row.Id}`,
            title: row.Name,
            year: row.ProductionYear ?? null,
            type: capType,
            genres: [],
            rating: null,
            overview: "",
            posterUrl: null,
            ids: {
              tmdb_id: row.ProviderIds?.Tmdb,
              imdb_id: row.ProviderIds?.Imdb,
              tvdb_id: row.ProviderIds?.Tvdb,
            },
          };
          results.push({
            item: mediaItem,
            progress: Math.min(100, Math.max(0, Math.round(row.UserData?.PlayedPercentage ?? 0))),
            pausedAt: row.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
            season: row.ParentIndexNumber,
            episode: row.IndexNumber,
            playbackId: `jellyfin:${row.Id}`,
          });
        }
        return results;
      },

      async removePosition(ctx, input) {
        const typedCtx = ctx as Ctx;
        const { playbackId } = input as { playbackId: string };
        const itemId = playbackId.startsWith("jellyfin:")
          ? playbackId.slice("jellyfin:".length)
          : playbackId;
        const userId = getUserId(typedCtx);
        // Jellyfin clears a resume point when the item is marked unplayed
        // without a played timestamp. Using /PlayingItems is for live
        // sessions; deleting the user's PlayedItems row only matters if it
        // was set. The practical clearer is to post a playback-stopped event
        // with PositionTicks=0 via /Sessions/Playing/Stopped, but without an
        // active session id we fall back to DELETE /Users/{userId}/Items/{id}
        // (which is not destructive — it only clears user metadata).
        const res = await jellyfinFetch(typedCtx, `/Users/${userId}/Items/${itemId}`, {
          method: "DELETE",
        });
        if (res.status === 401)
          throw pluginError("plugin.token_expired", "Jellyfin auth rejected (401)");
        if (res.status === 429)
          throw pluginError("plugin.rate_limited", "Jellyfin rate limited (429)");
        if (res.status >= 500)
          throw pluginError("plugin.upstream_error", `Jellyfin server error (${res.status})`);
        return { ok: res.ok || res.status === 404 };
      },
    },

    playbackSessions: {
      async getSessions(ctx, _input) {
        const typedCtx = ctx as Ctx;
        const cfg = getUserCfg(typedCtx);
        const cachedUserId = getUserId(typedCtx);
        const externalBase = getExternalBase(cfg);
        // Server-side filter so large servers don't return every session over
        // the wire. This is a payload-size hint only — the client-side
        // `session.UserId !== cachedUserId` check below remains the privacy
        // guarantee, because Jellyfin's behaviour when the filter is ignored
        // or a server returns extra entries must not leak other users'
        // sessions.
        const sessions = await jellyfinJson<JellyfinSession[]>(
          typedCtx,
          `/Sessions?controllableByUserId=${encodeURIComponent(cachedUserId)}`,
        );
        const entries: Array<{
          sessionId: string;
          deviceName: string;
          clientName?: string;
          user: { id: string; name: string };
          item: LibraryItem;
          progressMs: number;
          durationMs: number;
          state: "playing" | "paused" | "buffering";
          transcoding?: {
            videoDecision: "direct-play" | "copy" | "transcode";
            audioDecision: "direct-play" | "copy" | "transcode";
            targetBitrate?: number;
            reason?: string;
          };
          startedAt: string;
        }> = [];
        for (const session of sessions ?? []) {
          // Privacy: `/Sessions` returns server-wide sessions for admin
          // tokens; drop any session that does not belong to the cached
          // user. This is a guarantee, not an optimisation — never return
          // another user's session even if the underlying token can see it.
          if (!session.UserId || session.UserId !== cachedUserId) continue;
          if (!session.NowPlayingItem) continue;
          const item = mapLibraryItem(session.NowPlayingItem, externalBase);
          if (!item) continue;
          const progressMs = ticksToMs(session.PlayState?.PositionTicks);
          const durationMs = ticksToMs(session.NowPlayingItem.RunTimeTicks);
          const state: "playing" | "paused" | "buffering" = session.PlayState?.IsPaused
            ? "paused"
            : "playing";
          const entry: {
            sessionId: string;
            deviceName: string;
            clientName?: string;
            user: { id: string; name: string };
            item: LibraryItem;
            progressMs: number;
            durationMs: number;
            state: "playing" | "paused" | "buffering";
            transcoding?: {
              videoDecision: "direct-play" | "copy" | "transcode";
              audioDecision: "direct-play" | "copy" | "transcode";
              targetBitrate?: number;
              reason?: string;
            };
            startedAt: string;
          } = {
            sessionId: session.Id,
            deviceName: session.DeviceName ?? "Unknown",
            clientName: session.Client,
            user: { id: session.UserId, name: session.UserName ?? "" },
            item,
            progressMs,
            durationMs,
            state,
            startedAt: session.StartTimeUtc ?? new Date(0).toISOString(),
          };
          const method = session.PlayState?.PlayMethod;
          if (session.TranscodingInfo || method) {
            const videoDecision: "direct-play" | "copy" | "transcode" =
              session.TranscodingInfo?.IsVideoDirect === true
                ? "copy"
                : method === "Transcode"
                  ? "transcode"
                  : "direct-play";
            const audioDecision: "direct-play" | "copy" | "transcode" =
              session.TranscodingInfo?.IsAudioDirect === true
                ? "copy"
                : method === "Transcode"
                  ? "transcode"
                  : "direct-play";
            entry.transcoding = {
              videoDecision,
              audioDecision,
              ...(session.TranscodingInfo?.Bitrate
                ? { targetBitrate: Math.round(session.TranscodingInfo.Bitrate / 1000) }
                : {}),
              ...(session.TranscodingInfo?.TranscodeReasons?.length
                ? { reason: session.TranscodingInfo.TranscodeReasons.join(", ") }
                : {}),
            };
          }
          entries.push(entry);
        }
        return entries;
      },

      async stopSession(ctx, input) {
        const typedCtx = ctx as Ctx;
        const { sessionId } = input as { sessionId: string };
        const res = await jellyfinFetch(typedCtx, `/Sessions/${sessionId}/Playing/Stop`, {
          method: "POST",
        });
        handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
        // Jellyfin stops are remote-control commands — the server always
        // accepts the request and forwards it; an offline client may never
        // honour it. Surface that as `semantics: "requested"` so UIs don't
        // promise an immediate hard stop.
        return { ok: res.ok, semantics: "requested" as const };
      },
    },

    continueWatching: {
      async getContinueWatching(ctx, input) {
        const typedCtx = ctx as Ctx;
        const { type, limit = 20 } = input as {
          type?: "movie" | "show";
          limit?: number;
        };
        const userId = getUserId(typedCtx);
        const externalBase = getExternalBase(getUserCfg(typedCtx));
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        // Resume = in-progress items across movies + episodes; NextUp =
        // newest unwatched episodes per show.
        const resumeParams = new URLSearchParams({
          Limit: String(safeLimit),
          Fields: "ProviderIds,MediaSources,DateCreated,UserData",
        });
        if (type === "movie") resumeParams.set("MediaTypes", "Video");
        const resume = await jellyfinJson<{ Items: JellyfinItem[] }>(
          typedCtx,
          `/Users/${userId}/Items/Resume?${resumeParams.toString()}`,
        );
        type Entry = {
          item: LibraryItem;
          progressMs?: number;
          nextUp?: LibraryItem;
          lastPlayedAt?: string;
        };
        const entries: Entry[] = [];
        for (const row of resume.Items ?? []) {
          const capType = mapItemType(row.Type);
          if (!capType) continue;
          if (type === "movie" && capType !== "movie") continue;
          if (type === "show" && capType === "movie") continue;
          const item = mapLibraryItem(row, externalBase);
          if (!item) continue;
          const entry: Entry = { item };
          const progressMs = ticksToMs(row.UserData?.PlaybackPositionTicks);
          if (progressMs > 0) entry.progressMs = progressMs;
          if (row.UserData?.LastPlayedDate) entry.lastPlayedAt = row.UserData.LastPlayedDate;
          entries.push(entry);
        }
        // NextUp only fires when the caller wants shows.
        if (type !== "movie") {
          const nextUpParams = new URLSearchParams({
            UserId: userId,
            Limit: String(safeLimit),
            Fields: "ProviderIds,MediaSources,DateCreated,UserData",
          });
          const nextUp = await jellyfinJson<{ Items: JellyfinItem[] }>(
            typedCtx,
            `/Shows/NextUp?${nextUpParams.toString()}`,
          );
          for (const row of nextUp.Items ?? []) {
            const item = mapLibraryItem(row, externalBase);
            if (!item) continue;
            // Skip episodes that are already surfaced through Resume so the
            // feed doesn't double-count them.
            if (entries.some((e) => e.item.id === item.id)) continue;
            entries.push({ item });
          }
        }
        return entries.slice(0, safeLimit);
      },
    },

    watchHistory: {
      async getHistory(ctx, _input) {
        const typedCtx = ctx as Ctx;
        const userId = getUserId(typedCtx);
        // Hard cap of 200 items: the capability contract doesn't yet carry
        // pagination, and 200 is large enough for the current home-feed UX
        // without pulling multi-megabyte responses from large libraries.
        // Users with bigger histories will see the 200 most recently played.
        const params = new URLSearchParams({
          Recursive: "true",
          IsPlayed: "true",
          IncludeItemTypes: "Movie,Episode",
          Fields: "ProviderIds,UserData",
          SortBy: "DatePlayed",
          SortOrder: "Descending",
          Limit: "200",
        });
        const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
          typedCtx,
          `/Users/${userId}/Items?${params.toString()}`,
        );
        const results: Array<{
          item: MediaItemShape;
          watchedAt: string;
          progress: number;
        }> = [];
        for (const row of data.Items ?? []) {
          const capType = row.Type === "Movie" ? "movie" : row.Type === "Episode" ? "tv" : null;
          if (!capType) continue;
          results.push({
            item: {
              id: `jellyfin:${row.Id}`,
              title: row.Name,
              year: row.ProductionYear ?? null,
              type: capType,
              genres: [],
              rating: null,
              overview: "",
              posterUrl: null,
              ids: {
                tmdb_id: row.ProviderIds?.Tmdb,
                imdb_id: row.ProviderIds?.Imdb,
                tvdb_id: row.ProviderIds?.Tvdb,
              },
            },
            watchedAt: row.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
            progress: 100,
          });
        }
        return results;
      },

      async addToHistory(ctx, input) {
        const typedCtx = ctx as Ctx;
        const items = input as Array<{ ids?: { "jellyfin:itemId"?: string } }>;
        const userId = getUserId(typedCtx);
        const itemIds = items.map((it) => {
          const itemId = it.ids?.["jellyfin:itemId"];
          if (!itemId) {
            throw pluginError(
              "plugin.input_invalid",
              "Jellyfin.addToHistory requires `jellyfin:itemId` on every item",
            );
          }
          return itemId;
        });
        // Jellyfin has no batch endpoint; fan out in parallel so an N-item
        // call is ~N× faster than a sequential loop.
        const responses = await Promise.all(
          itemIds.map((itemId) =>
            jellyfinFetch(typedCtx, `/Users/${userId}/PlayedItems/${itemId}`, { method: "POST" }),
          ),
        );
        for (const res of responses) {
          handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
        }
        return { added: responses.filter((r) => r.ok).length };
      },

      async removeFromHistory(ctx, input) {
        const typedCtx = ctx as Ctx;
        const items = input as Array<{ ids?: { "jellyfin:itemId"?: string } }>;
        const userId = getUserId(typedCtx);
        const itemIds = items.map((it) => {
          const itemId = it.ids?.["jellyfin:itemId"];
          if (!itemId) {
            throw pluginError(
              "plugin.input_invalid",
              "Jellyfin.removeFromHistory requires `jellyfin:itemId` on every item",
            );
          }
          return itemId;
        });
        const responses = await Promise.all(
          itemIds.map((itemId) =>
            jellyfinFetch(typedCtx, `/Users/${userId}/PlayedItems/${itemId}`, { method: "DELETE" }),
          ),
        );
        for (const res of responses) {
          if (res.status === 401)
            throw pluginError("plugin.token_expired", "Jellyfin auth rejected (401)");
          if (res.status === 429)
            throw pluginError("plugin.rate_limited", "Jellyfin rate limited (429)");
          if (res.status >= 500)
            throw pluginError("plugin.upstream_error", `Jellyfin server error (${res.status})`);
        }
        return { removed: responses.filter((r) => r.ok || r.status === 404).length };
      },
    },

    libraryAdmin: {
      async refreshLibrary(ctx, _input) {
        // Jellyfin only exposes a server-wide refresh; per-section is not a
        // first-class endpoint. `/Library/Refresh` kicks all libraries, which
        // matches the contract's "plugin refreshes all sections it can see".
        return jellyfinFireAndForget(ctx as Ctx, `/Library/Refresh`);
      },

      async refreshItem(ctx, input) {
        const { serverItemId } = input as { serverItemId: string };
        return jellyfinFireAndForget(ctx as Ctx, `/Items/${serverItemId}/Refresh`);
      },
    },

    idResolve: {
      async resolve(ctx, input) {
        const typedCtx = ctx as Ctx;
        const { from, id, type } = input as {
          from: "tmdb" | "tvdb" | "trakt" | "imdb" | "plex:ratingKey" | "jellyfin:itemId";
          id: string;
          type: "movie" | "tv";
        };

        if (from === "jellyfin:itemId") {
          // Translate a local item id back to cross-service handles via
          // ProviderIds.
          try {
            const item = await jellyfinJson<JellyfinItem>(typedCtx, `/Items/${id}`);
            const providers = item.ProviderIds ?? {};
            const out: Record<string, string | undefined> = {
              tmdb: providers.Tmdb,
              imdb: providers.Imdb,
              tvdb: providers.Tvdb,
              "jellyfin:itemId": item.Id,
            };
            return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
          } catch (err) {
            if (
              typeof err === "object" &&
              err !== null &&
              (err as { code?: string }).code === "plugin.item_not_found"
            ) {
              return {};
            }
            throw err;
          }
        }

        if (from === "plex:ratingKey") {
          // Not resolvable by Jellyfin — Plex ratingKeys only mean something
          // against a Plex server. Return empty rather than fabricating.
          return {};
        }

        // Cross-service handles: look up the first matching local item and
        // return whatever other ids it carries.
        const provider =
          from === "tmdb" ? "Tmdb" : from === "imdb" ? "Imdb" : from === "tvdb" ? "Tvdb" : null;
        if (!provider) return {};
        const userId = getUserId(typedCtx);
        const jfType = type === "movie" ? "Movie" : "Series";
        const params = new URLSearchParams({
          IncludeItemTypes: jfType,
          Recursive: "true",
          AnyProviderIdEquals: `${provider}.${id}`,
          Fields: "ProviderIds",
        });
        const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
          typedCtx,
          `/Users/${userId}/Items?${params.toString()}`,
        );
        const hit = data.Items?.[0];
        if (!hit) return {};
        const providers = hit.ProviderIds ?? {};
        const out: Record<string, string | undefined> = {
          tmdb: providers.Tmdb,
          imdb: providers.Imdb,
          tvdb: providers.Tvdb,
          "jellyfin:itemId": hit.Id,
        };
        return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
      },
    },
  },
});

# MCP Server on Top of MediaService

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-frontend-connections-design.md`, `2026-04-19-error-management-design.md`
**Revises:** Adds `mcpTools` to capability definitions and the plugin manifest (see §8)

## Summary

This document designs the MCP (Model Context Protocol) surface of the application — how external agents like Claude Desktop, Claude Code, and similar clients reach user data and capabilities. The design sits as a thin translation layer on top of `MediaService`: the MCP handler verifies an OAuth 2.1 JWT, looks up the requested tool in a registry, validates input, calls into `MediaService`, compresses the response, and returns. No new dispatch, runtime, credential vault, or caching is introduced — the MCP layer reuses what already exists.

The design follows the token-efficiency discipline from the initial compass document: a small number of outcome-oriented tools, aggressive server-side enrichment and compression, and a consent-gated scope model. Six tools cover the daily user workflows — discover, inspect, request, track, give feedback, and see connected accounts — at a ~3,900-token baseline for the agent's context window. Plugins can additionally contribute namespaced `ext_*` tools for service-specific functionality without weakening the outcome-oriented discipline of the core surface.

## Goals

- Expose MediaService to MCP clients as a small, token-efficient tool surface (six outcome-oriented tools).
- Treat capability-level dispatch as the source of truth — MCP tools know nothing about specific plugins.
- Reuse Better Auth's oauth-provider plugin for MCP spec-compliant authorization; no custom OAuth server.
- Allow plugins to contribute `ext_*` MCP tools that share the same runtime, auth, and error-handling machinery.
- Produce errors in the canonical `UserFacingError` shape from the error-management doc; participate in the existing capture pipeline.
- Keep the door open to streaming responses, per-plugin scopes, and PAT auth without requiring a refactor.

## Non-goals

- Custom OAuth authorization server. Better Auth provides it.
- Personal access tokens (PATs) in v1. Deferred; when added, they issue the same JWTs with the same scopes, so tool handlers don't change.
- Streaming tool responses in v1. All six tools fit in synchronous request/response.
- Embedding-based re-ranking internals. `ent_discover` in `recommend` mode calls into the preference engine via an interface; the engine's design is a separate document.
- Product analytics on tool calls (frequency, funnels, retention). Out of scope per the error-management doc's same stance.
- User-installable MCP clients outside the OAuth flow. Dynamic client registration is enabled; no other registration path in v1.

## Architecture

```
                    ┌──────────────────────────────┐
                    │   MCP Client                  │
                    │   (Claude Desktop, Cursor,    │
                    │    Claude Code, custom)       │
                    └──────────────┬───────────────┘
                                   │  HTTPS + Bearer JWT
                                   │  Streamable HTTP (POST/GET/DELETE)
                                   ▼
                    ┌──────────────────────────────┐
                    │ /api/mcp (Hono route)         │
                    │                              │
                    │ Better Auth mcpHandler:       │
                    │  • verify JWT via JWKS        │
                    │  • extract userId from sub    │
                    │  • attach scopes              │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ Tool Dispatcher               │
                    │  • registry lookup            │
                    │  • scope check                │
                    │  • ajv input validation       │
                    │  • requestId → AsyncLocalSt.  │
                    └──────────────┬───────────────┘
                                   │
                      ┌────────────┼────────────┐
                      ▼            ▼            ▼
          ┌──────────────┐ ┌─────────────┐ ┌────────────────┐
          │ Capability   │ │ Composite   │ │ Extension      │
          │ tool handler │ │ tool handler│ │ tool wrapper   │
          │              │ │             │ │                │
          │ 1 handler    │ │ switches on │ │ calls          │
          │ → 1 capab.   │ │ mode/view,  │ │ MediaService   │
          │              │ │ calls N     │ │ .callExtension │
          │              │ │ capabilities│ │                │
          └──────┬───────┘ └──────┬──────┘ └───────┬────────┘
                 │                │                │
                 └────────────────┼────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────────┐
                    │   MediaService (existing)     │
                    │   + callExtension (new)       │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   Plugin Runtime (existing)   │
                    └──────────────────────────────┘
```

The MCP subsystem has five concerns, each a distinct module:

- **Transport and auth.** Hono route wrapped by Better Auth's `mcpHandler`; well-known endpoints for discovery.
- **Tool registry.** In-memory, rebuilt on plugin lifecycle events; holds capability-owned, composite, and `ext_*` tools uniformly.
- **Tool dispatcher.** Validates input, checks scope, runs handlers, validates output, captures errors per the error-management pipeline.
- **Tool handlers.** Pure translation logic between the MCP surface and `MediaService`. No database, no runtime, no auth — all of that is below.
- **Response compression.** A module of pure functions that shape `MediaItem` and other `MediaService` outputs into the compact agent-facing shapes.

The key architectural point: **the MCP layer adds no new infrastructure below itself.** It translates between the MCP protocol and `MediaService`. Everything that makes plugins work — sandboxing, credential vaulting, capability registry, dispatch strategies, caching, error capture — is already in place.

## Tool registry

The registry is the central data structure. Every exposed tool, regardless of where it's declared, becomes a uniform record:

```ts
interface RegisteredTool {
  name: string; // e.g. "ent_discover" or "ext_trakt_rescan"
  source:
    | { kind: "capability"; capabilityId: string; version: string }
    | { kind: "composite"; id: string }
    | { kind: "extension"; pluginId: string };
  description: string; // agent-facing, ≤ 400 chars
  inputSchema: JSONSchema; // ajv-validated before handler runs
  outputSchema: JSONSchema; // ajv-validated after handler returns
  annotations?: MCPToolAnnotations; // destructiveHint, idempotentHint, readOnlyHint
  requiredScopes: string[]; // checked against JWT scope claim
  handler: (ctx: ToolCallContext, input: unknown) => Promise<unknown>;
}

interface ToolCallContext {
  userId: string; // from verified JWT sub
  scopes: string[]; // from JWT scope claim
  mediaService: MediaService;
  logger: Logger; // tagged with tool name + userId + requestId
  // No credentials, no plugin access — handlers go through MediaService.
}
```

`source` is internal metadata for logging and the admin UI. It is never exposed to the MCP client. `outputSchema` is also internal — MCP's `tools/list` includes only `{ name, description, inputSchema, annotations }`.

### Three declaration sites

Tools enter the registry from three places, all sharing the record shape above.

**Capability-owned tools.** The capability definition gains an optional `mcpTools` field:

```ts
export const MetadataV1 = defineCapability({
  id: "metadata",
  version: "v1",
  strategy: "primary_with_enrichment",
  defaultCacheTtlSec: 60 * 60 * 24,
  methods: {
    /* as before */
  },
  mcpTools: [
    {
      name: "ent_details",
      description: "Get enriched details for a specific movie or TV show ...",
      inputSchema: {
        /* JSON Schema */
      },
      outputSchema: {
        /* JSON Schema */
      },
      requiredScopes: ["mcp.read"],
      handler: entDetailsHandler,
    },
  ],
});
```

The capability's Zod schemas remain the source of truth for method inputs/outputs. The MCP tool's JSON Schema is authored separately because it is the _agent-facing_ contract, which is shaped differently (e.g. the `id` parameter is `"movie:550"` rather than `{ tmdb_id: "550", media_type: "movie" }`). The handler does the translation.

Tools registered this way go live as soon as their capability is registered in the host, regardless of whether any plugin implements the capability. If no plugin implements `metadata@v1` and the agent calls `ent_details`, the handler receives an empty dispatch result and returns `mcp.not_connected` with guidance for the user. **Tools are never hidden from `tools/list` based on what plugins are installed** — hiding them would change the agent's available surface dynamically, which causes more confusion than it prevents.

**Composite tools.** Declared in a host module, not in any capability:

```ts
// server/mcp/composite-tools/ent-discover.ts
export const entDiscoverTool: CompositeTool = {
  id: "ent_discover",
  name: "ent_discover",
  description: "Search, browse, or get personalized recommendations ...",
  inputSchema: {
    /* the mode-parameter schema */
  },
  outputSchema: {
    /* results array schema */
  },
  requiredScopes: ["mcp.read"],
  handler: entDiscoverHandler, // switches on mode, calls MediaService
};
```

The host has a fixed, small set of composite tools. In v1: `ent_discover`, `ent_activity`, `ent_feedback`. Adding a new composite is a host code change, not configuration.

**Plugin `ext_*` tools.** Declared in the plugin manifest:

```ts
{
  // ... rest of manifest
  mcpTools: [
    {
      name: "rescan",                  // host prefixes to "ext_trakt_rescan"
      description: "Force a full refresh of Trakt history for the current user.",
      inputSchema: { /* ... */ },
      outputSchema: { /* ... */ },
      handler: "rescan",               // name of an exported handler on the plugin
      annotations: { idempotentHint: true },
    },
  ],
}
```

The plugin exports `rescan(ctx, input)` alongside its capability methods and job handlers. The host registers this as `ext_trakt_rescan` with a wrapper handler that dispatches into the plugin runtime via `MediaService.callExtension`.

### Validation at registration

Capability-owned and composite tools must not use names starting with `ext_`. Enforced at host startup; failure is a fatal boot error.

Plugin `ext_*` tools are subject to manifest-install validation:

- `name` matches `/^[a-z][a-z0-9_]*$/`.
- `name` length keeps the prefixed full name (`ext_<plugin_id>_<name>`) ≤ 64 chars.
- `description` ≤ 400 chars; per-property descriptions in the schemas ≤ 200 chars each.
- `handler` matches an exported key on the plugin's `mcpTools` object.
- `inputSchema` and `outputSchema` are valid JSON Schema (validated with `ajv`).
- A plugin's `mcpTools` array is capped at 5 entries.

The length and count caps are a design choice, not a technical limit. The token-efficiency discipline has teeth: plugin authors who want to expose more than five tools should open an issue, because the default answer is "make it a capability."

### Lifecycle

The registry is rebuilt on three events:

1. **Host startup.** All capability-owned and composite tools register immediately. Enabled plugins' `ext_*` tools register as each plugin's runtime instance boots.
2. **Plugin install/update/enable.** The plugin's `ext_*` tools are added (or replaced on update).
3. **Plugin disable/uninstall.** The plugin's `ext_*` tools are removed.

Capability-owned and composite tools never unregister during a host's lifetime; they're tied to the host's own code.

## The six tools

### Universal conventions

Three conventions apply across all six tools.

**Media IDs use TMDB as the canonical surface.** The agent sees `"movie:550"` or `"tv:1396"`. Tool handlers parse this into `{ tmdb_id, media_type }` for `MediaService`. TMDB is canonical because Seerr uses TMDB IDs natively, TMDB's coverage is broadest, and MediaService's `id_map` resolves to other ID types when a plugin needs them — invisible to the agent.

**Compact responses omit absent fields.** `user_rated`, `match_reason`, `watch_progress`, etc. are never included when null or not applicable. The JSON Schema marks them as optional. This is compression, not optionality.

**Structured errors use `UserFacingError`.** All tools return errors in the canonical shape from the error-management doc, with code-specific payloads under `details`:

```json
{
  "error": {
    "code": "mcp.ambiguous_target",
    "params": { "capability": "mediaRequest@v1" },
    "devMessage": "User has 2 connections for mediaRequest@v1 and no target specified",
    "requestId": "7f3a2b1c",
    "details": {
      "candidates": [
        { "connection_id": "conn_abc", "display_name": "Home Seerr" },
        { "connection_id": "conn_xyz", "display_name": "Family Seerr" }
      ]
    }
  }
}
```

The agent reads `devMessage` (English) and can use structured `details` to disambiguate (e.g. offer the user choices, then retry with `target: "conn_abc"`).

### `ent_discover` — composite

Outcome-oriented search, recommendations, similar titles, trending, and filtered discovery. Composite because the modes dispatch across different capabilities.

```json
{
  "name": "ent_discover",
  "description": "Search, browse, or get personalized recommendations for movies and TV. mode=search for text search, recommend for personalized picks, similar for items like a specific title, trending for popular now, discover for filtered browse.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["search", "recommend", "similar", "trending", "discover"]
      },
      "query": {
        "type": "string",
        "description": "Search text for search mode, or a title/id for similar mode"
      },
      "media_type": { "type": "string", "enum": ["movie", "tv", "any"], "default": "any" },
      "genres": { "type": "string", "description": "Comma-separated genre names" },
      "year_min": { "type": "integer" },
      "year_max": { "type": "integer" },
      "limit": { "type": "integer", "default": 10, "maximum": 25 }
    },
    "required": ["mode"]
  },
  "requiredScopes": ["mcp.read"]
}
```

| Mode        | MediaService call                                                   | Notes                                                                   |
| ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `search`    | `metadata@v1.search`                                                | Filters passed through where supported                                  |
| `recommend` | `recommendations@v1.getRecommendations` + preference-engine re-rank | Merged results re-ranked against user's preference profile              |
| `similar`   | `metadata@v1.getSimilar`                                            | If `query` isn't an id, handler first resolves via `metadata@v1.search` |
| `trending`  | `recommendations@v1.getTrending`                                    | New method on the capability (non-breaking addition)                    |
| `discover`  | `metadata@v1.discover`                                              | New method on the capability (non-breaking addition)                    |

Adding `getTrending` to `recommendations@v1` and `discover` to `metadata@v1` are backward-compatible additions: plugins that don't implement them are silently skipped in `aggregate`; in `primary_with_enrichment`, their absence means the feature is unavailable for users whose primary doesn't support them. This avoids inventing a `discovery@v1` mega-capability.

**Response:**

```json
{
  "results": [
    {
      "id": "movie:550",
      "title": "Fight Club",
      "year": 1999,
      "type": "movie",
      "genres": ["Drama", "Thriller"],
      "rating": 8.4,
      "overview": "...",
      "poster": "https://...",
      "status": "available",
      "user_rated": 9,
      "match_reason": "Similar dark tone and unreliable narrator to Gone Girl"
    }
  ],
  "total": 47,
  "has_more": true
}
```

- `status` collapses `mediaRequest@v1.getStatus` output into one of `available`, `requested`, `processing`, `unavailable`, `unknown`. Batched per-page for the result set.
- `user_rated` appears only when `ratings@v1.getRating` returns a value (aggregated across rating plugins; most-recent wins per the MediaService doc).
- `match_reason` appears only for `recommend` and `similar`, generated by the preference engine during re-ranking.

`ent_discover` does not accept a `target` parameter. All its modes are read operations under `aggregate` or `primary_with_enrichment` strategies.

### `ent_details` — capability-owned (`metadata@v1`)

```json
{
  "name": "ent_details",
  "description": "Get enriched details for a specific movie or TV show including metadata, cast, ratings, availability, and your watch status.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "TMDB ID prefixed with type, e.g. 'movie:550' or 'tv:1396'"
      }
    },
    "required": ["id"]
  },
  "requiredScopes": ["mcp.read"]
}
```

Four MediaService calls in parallel:

1. `metadata@v1.getById` — base details
2. `ratings@v1.getRating` — aggregated ratings
3. `mediaRequest@v1.getStatus` — availability
4. Host: read preference-engine feedback for this tmdb_id

For TV shows, additionally `watchHistory@v1.getShowProgress`.

**Response:**

```json
{
  "id": "movie:550",
  "title": "Fight Club",
  "year": 1999,
  "genres": ["Drama", "Thriller"],
  "runtime": 139,
  "overview": "...",
  "director": "David Fincher",
  "cast": ["Brad Pitt", "Edward Norton", "Helena Bonham Carter"],
  "ratings": { "tmdb": 8.4, "trakt": 8.1, "user": 9 },
  "poster": "https://...",
  "trailer": "https://...",
  "streaming": ["Netflix", "Amazon Prime"],
  "status": "available",
  "watch_progress": null,
  "keywords": ["twist ending", "split personality", "anti-consumerism"]
}
```

Truncation: top 3 cast, top 8 keywords. The `ratings` object keys are plugin-identifying (`tmdb`, `trakt`, etc.) plus `user` for the user's own rating. This is the right place to leak plugin identity — the agent should know which service a rating came from.

### `ent_request` — capability-owned (`mediaRequest@v1`), supports `target`

```json
{
  "name": "ent_request",
  "description": "Request a movie or TV show download, or check status of existing requests.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["create", "status"], "default": "status" },
      "id": { "type": "string", "description": "TMDB ID. Required for action=create." },
      "seasons": {
        "type": "string",
        "description": "For TV: 'all', 'latest', or comma-separated like '1,2,3'"
      },
      "target": {
        "type": "string",
        "description": "Connection ID when you have multiple request providers. Omit to use default."
      }
    }
  },
  "annotations": { "destructiveHint": false, "idempotentHint": false },
  "requiredScopes": ["mcp.write.request"]
}
```

**Dispatch for `action: "create"`:**

- Calls `mediaRequest@v1.create` with strategy `single`.
- If user has >1 eligible connection and `target` is omitted → `mcp.ambiguous_target` with `details.candidates`.
- If `target` is provided → MediaService routes to that specific connection.
- If `target` points to a connection that doesn't belong to the user or doesn't implement `mediaRequest@v1` → `mcp.target_not_found`.

**Dispatch for `action: "status"`:**

- Calls `mediaRequest@v1.listRequests` across all eligible connections (aggregate).
- `target` is optional: filters to that connection if provided.

**Response for `create`:**

```json
{ "requested": true, "id": "movie:550", "target": "conn_abc", "status": "processing" }
```

**Response for `status`:**

```json
{
  "requests": [
    {
      "id": "movie:550",
      "title": "Fight Club",
      "status": "processing",
      "target": "conn_abc",
      "requested_at": "2026-04-18T10:22:00Z"
    }
  ]
}
```

### `ent_activity` — composite

Views the user's watchlist, history, upcoming episodes, or show progress. Composite because each view routes to a different capability.

```json
{
  "name": "ent_activity",
  "description": "View your watchlist, recent watch history, upcoming episodes, or show progress.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "view": {
        "type": "string",
        "enum": ["watchlist", "history", "upcoming", "progress"],
        "default": "watchlist"
      },
      "media_type": { "type": "string", "enum": ["movie", "tv", "any"], "default": "any" },
      "limit": { "type": "integer", "default": 15 }
    }
  },
  "requiredScopes": ["mcp.read"]
}
```

| View        | MediaService call                                          | Strategy  |
| ----------- | ---------------------------------------------------------- | --------- |
| `watchlist` | `watchlist@v1.list`                                        | aggregate |
| `history`   | `watchHistory@v1.getHistory`                               | aggregate |
| `upcoming`  | `calendar@v1.getUpcoming`                                  | aggregate |
| `progress`  | `watchHistory@v1.getShowProgress` across in-progress shows | aggregate |

Response uses the same `results` array shape as `ent_discover`, with availability resolved via `mediaRequest@v1.getStatus`.

### `ent_feedback` — composite

Records user preference signals. Composite because it writes to both the host's `feedback_log` _and_ optionally to `ratings@v1` plugins.

```json
{
  "name": "ent_feedback",
  "description": "Record your opinion on a movie or show. Supports likes, dislikes, ratings, and free-text notes that improve future recommendations.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "action": { "type": "string", "enum": ["like", "dislike", "rate", "note"] },
      "rating": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10,
        "description": "Required when action=rate"
      },
      "note": { "type": "string", "description": "Free-text feedback; required when action=note" },
      "target": {
        "type": "string",
        "description": "Connection ID when you have multiple rating providers and action=rate. Omit to write to all."
      }
    },
    "required": ["id", "action"]
  },
  "requiredScopes": ["mcp.write.feedback"]
}
```

**Dispatch:**

1. Always: write to host's `feedback_log` with `{ userId, tmdbId, mediaType, action, rating?, note?, timestamp }`.
2. Always: trigger preference-engine update for this user (async; does not block the response).
3. For `action: "rate"` only: write rating to `ratings@v1` plugins.
   - Default (no `target`): write to _all_ connected rating plugins. Ratings are typically something users want mirrored (e.g. "rate this 8" on both Trakt and any other tracker).
   - With `target`: write only to the specified connection.
   - One plugin failing does not fail the whole call — surfaces as a partial result.
4. For `action: "like" | "dislike" | "note"`: no plugin write. Preference-engine only.

`target` is documented as applying only when `action=rate`. For other actions with `target` present, returns `mcp.bad_input` rather than silently ignoring — the explicit error catches agent misunderstandings early.

The rating fan-out is neither `aggregate` nor `single` in the strict sense — it's a "broadcast" pattern. Rather than inventing a new strategy for this single case, the composite handler drives the fan-out explicitly by calling `MediaService.setRating(userId, tmdbId, rating, { connectionIds })` with a specific list. This keeps the strategy vocabulary small (three strategies) at the cost of making this particular write explicit.

**Response:**

```json
{
  "recorded": true,
  "synced_to": ["conn_trakt"],
  "profile_update": "Decreased preference for slow-paced dramas"
}
```

`synced_to` is empty for non-rate actions. `profile_update` is a short human-readable description the preference engine returns as a side effect; the agent can relay it to the user.

### `ent_account` — host-owned, read-only

```json
{
  "name": "ent_account",
  "description": "List your connected services, their status, and what they provide.",
  "inputSchema": { "type": "object", "properties": {} },
  "requiredScopes": ["mcp.read"]
}
```

Reads from the existing `service_connections` table (already user-scoped via the `account:connections` permission model) and the capability registry.

**Response:**

```json
{
  "connections": [
    {
      "id": "conn_abc",
      "plugin_id": "trakt",
      "plugin_name": "Trakt",
      "display_name": "My Trakt",
      "status": "connected",
      "capabilities": ["watchHistory@v1", "watchlist@v1", "ratings@v1", "recommendations@v1"],
      "is_default_for_capability": ["watchHistory@v1"]
    },
    {
      "id": "conn_def",
      "plugin_id": "seerr",
      "plugin_name": "Seerr",
      "display_name": "Home Seerr",
      "status": "expired",
      "capabilities": ["mediaRequest@v1"],
      "is_default_for_capability": ["mediaRequest@v1"],
      "error_message": "Token expired — reconnect in your settings"
    }
  ],
  "missing_capabilities": ["calendar@v1"]
}
```

`missing_capabilities` lists capabilities the host knows about but for which the user has no connected plugin. The agent can use this to guide the user ("you haven't connected anything that provides upcoming episodes").

Read-only. If the agent encounters `mcp.not_connected` from another tool, it can call `ent_account` to see what's actually available.

## Plugin `ext_*` tools

Plugin-contributed tools for plugin-specific functionality that doesn't fit a capability. Namespaced `ext_<plugin_id>_<name>` to prevent collision and signal to the agent that the tool is service-specific.

### Manifest declaration

A new optional `mcpTools` field on the plugin manifest:

```ts
interface PluginManifest {
  // ... existing fields
  mcpTools?: Array<{
    name: string;
    description: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    handler: string; // exported handler key
    annotations?: MCPToolAnnotations;
  }>;
}
```

Validation rules are in §3 (Tool registry).

### Plugin entry point

The plugin exports an `mcpTools` object alongside `capabilities` and `jobs`:

```ts
export default definePlugin({
  manifest: { /* includes mcpTools array */ },

  capabilities: {
    watchHistory: { getHistory: ..., addToHistory: ... },
  },

  mcpTools: {
    rescan: async (ctx, input: { force?: boolean }) => {
      // plugin-specific logic using ctx.fetch, ctx.credentials, etc.
      return { scanned: true, items_refreshed: 142 };
    },
  },

  jobs: { /* ... */ },
});
```

Handlers receive the same `PluginContext<TCred, TUserCfg, TGlobalCfg>` that capability methods receive. Same runtime, same sandbox, same `ctx.fetch` allowlist, same rate limits.

### Dispatch

The registered tool record for an `ext_*` tool has a handler that calls:

```ts
class MediaService {
  async callExtension<T>(
    userId: string,
    pluginId: string,
    handlerName: string,
    input: unknown,
  ): Promise<T>;
}
```

`callExtension` is the single new method on `MediaService`. It:

1. Resolves connections for this plugin (single-or-shared, same path as capability calls).
2. Picks the default connection (or the shared-credentials entry). Strategy is always `single` for `ext_*` tools; if multiple connections exist and no `target` is given, returns `mcp.ambiguous_target`.
3. Builds `PluginContext`.
4. Invokes `plugin.mcpTools[handlerName](ctx, input)` via the runtime.
5. Validates output against the tool's `outputSchema`.
6. Normalizes errors through the same retry-and-status-update path as capability calls.
7. Returns the result.

### Constraints inherited from the sandbox

An extension tool cannot call other plugins, touch the database, use `setTimeout`/`setInterval`, run dynamic code, or hit hosts outside `manifest.allowedHosts`. It runs within the plugin's 15s timeout and memory cap. If a plugin author wants to orchestrate multiple capabilities, the answer is "propose a composite tool for the host," not "give plugins more power."

### No cache, no id_map harvest

Extension tools don't use the `MediaService` cache. Capability calls cache because identical calls for the same user return the same data; extension tools are arbitrary plugin operations with no consistent shape. Plugins can cache internally via `ctx.store`.

`id_map` harvesting also doesn't apply. Harvesting works because capability responses have a known schema (`MediaItem` with an `ids` field); extension outputs are arbitrary.

### Guidance for plugin authors

A new section in the plugin-authoring guide:

- If the functionality is something users of any similar service would want, propose a new capability.
- If the functionality is specific to your plugin and doesn't make sense for other services (e.g. Trakt-specific scrobble override, Seerr-specific request-queue management, plugin-local cache reset), it's an `ext_*` tool.
- When in doubt, it's probably a capability.

The host doesn't mechanically reject `ext_*` tools that "should have been capabilities." The 5-tool-per-plugin cap is the only real pressure; everything else is editorial.

## Transport, auth, and wiring

### Endpoint

Streamable HTTP MCP at `/api/mcp`, handled by the `mcp-handler` package wrapped by Better Auth's `mcpHandler`:

```ts
// server/routes/mcp.ts
const handler = mcpHandler(
  {
    jwksUrl: `${BASE_URL}/api/auth/jwks`,
    verifyOptions: {
      issuer: BASE_URL,
      audience: `${BASE_URL}/api/mcp`,
    },
  },
  (req, jwt) => {
    const userId = jwt.sub;
    return createMcpHandler(
      (server) => {
        for (const tool of mcpToolRegistry.list()) {
          server.registerTool(
            tool.name,
            {
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: tool.annotations,
            },
            async (input) => {
              return await dispatchTool(
                tool,
                {
                  userId,
                  scopes: jwt.scope?.split(" ") ?? [],
                  mediaService: globalMediaService,
                  logger: logger.child({ tool: tool.name, userId, requestId: getRequestId() }),
                },
                input,
              );
            },
          );
        }
      },
      { serverInfo: { name: "your-app", version: APP_VERSION } },
      { basePath: "/api", maxDuration: 60 },
    )(req);
  },
);

app.all("/api/mcp", handler);
app.all("/api/mcp/*", handler);
```

`dispatchTool` is the shim that runs ajv input validation, checks scopes, invokes the handler, runs ajv output validation, and converts thrown errors into `UserFacingError` shapes. It sets the MCP request ID into AsyncLocalStorage so downstream error captures correlate.

### OAuth server

Better Auth's oauth-provider plugin:

```ts
oauthProvider({
  loginPage: "/sign-in",
  consentPage: "/consent",
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true, // MCP clients self-register
  validAudiences: [BASE_URL, `${BASE_URL}/api/mcp`],
  scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
  clientRegistrationDefaultScopes: MCP_DEFAULT_SCOPES,
  clientRegistrationAllowedScopes: MCP_SCOPES,
});
```

`allowUnauthenticatedClientRegistration` lets Claude Desktop, Cursor, and similar clients self-register as public clients on first connect. Without it, each client would need a manually-registered `client_id`, which defeats the "paste the URL" UX those clients assume.

### Well-known endpoints

Three Hono routes, one-liners per Better Auth's conventions:

```ts
app.get("/.well-known/oauth-authorization-server", oauthProviderAuthServerMetadata(auth));
app.get("/.well-known/openid-configuration", oauthProviderOpenIdConfigMetadata(auth));
app.get("/.well-known/oauth-protected-resource/api/mcp", async () => {
  const metadata = await serverClient.getProtectedResourceMetadata({
    resource: `${BASE_URL}/api/mcp`,
    authorization_servers: [BASE_URL],
  });
  return Response.json(metadata);
});
```

### Scopes

Scopes express "what can this agent do on behalf of this user." The vocabulary is deliberately coarse and outcome-oriented — aligned to tools, not to capabilities or plugins. Four scopes:

| Scope                | Tools granted                                                |
| -------------------- | ------------------------------------------------------------ |
| `mcp.read`           | `ent_discover`, `ent_details`, `ent_activity`, `ent_account` |
| `mcp.write.feedback` | `ent_feedback`                                               |
| `mcp.write.request`  | `ent_request` (`create` and `status`)                        |
| `mcp.ext`            | All `ext_*` tools                                            |

Defaults for dynamically-registered clients: `mcp.read` and `mcp.write.feedback`. Clients can request additional scopes at authorization time; the user sees the consent screen and approves.

Each `RegisteredTool` declares `requiredScopes`. The dispatcher checks `jwt.scope` before invoking the handler. Missing scope → `mcp.forbidden` with `details.missing_scopes` so the agent can prompt the user to re-authorize with the needed scope.

**Why scope granularity is coarse.** Per-capability or per-plugin scopes would produce ~20 scopes and a consent screen nobody reads. Coarse outcome-oriented scopes match the tool design and the user's mental model. Finer-grained authorization, if needed later, lives at the connection level (already covered by `account:connections` from the plugin architecture doc).

**Why `mcp.ext` is one scope in v1.** `ext_*` tools are plugin-specific and unpredictable at design time. Either the user trusts the agent to call plugin-specific tools or they don't; splitting per-plugin would explode the consent screen on every plugin install.

### Session state

Stateless at the app level. MCP session IDs live in Postgres and Redis via whatever `CacheProvider` is configured (Redis for multi-instance deployments), handled internally by the `mcp-handler` package.

### Rate limiting

Two layers:

1. **Better Auth's built-in per-IP rate limiting** on OAuth endpoints (`/oauth2/token`, `/oauth2/authorize`, etc.). Defaults are fine.
2. **Per-user MCP rate limiting** on `/api/mcp`: a token bucket keyed by JWT `sub`, default 60 tool calls per minute, configurable via env. Excess returns `mcp.rate_limited` with a `retry_after` param.

The per-user limit prevents an over-eager agent from hammering the server (and transitively external APIs). Per-external-API rate limits remain the responsibility of each plugin's `ctx.fetch` enforcement.

### CORS

The `/.well-known/*` endpoints have permissive CORS for local testing with the MCP Inspector (documented by Better Auth). `/api/mcp` does not — MCP clients are not browsers.

## Error handling

The MCP layer participates in the error-management pipeline from the error-management doc. No new machinery.

### Wire format

All tool errors conform to `UserFacingError`:

```ts
interface UserFacingError {
  code: string; // stable, namespaced
  params?: Record<string, string | number>;
  devMessage: string; // English, for logs/viewer and agent fallback
  cause?: unknown;
  requestId?: string;
  details?: Record<string, unknown>; // code-specific payload
}
```

The MCP dispatcher adds `requestId` from AsyncLocalStorage before returning.

### New MCP-specific codes

Added to `HOST_ERROR_CODES` (adding a code forces a translation entry, preserving the error-doc's discipline):

| Code                   | When                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `mcp.ambiguous_target` | `single`-strategy write with >1 eligible connection and no `target`                               |
| `mcp.target_not_found` | `target` provided but not a valid connection of the user / doesn't support the capability         |
| `mcp.forbidden`        | JWT scope doesn't grant the required tool scope                                                   |
| `mcp.invalid_id`       | Malformed media id                                                                                |
| `mcp.not_connected`    | Capability has zero connections; tool returns a structured "no sources" response                  |
| `mcp.rate_limited`     | Per-user MCP rate limit exceeded                                                                  |
| `mcp.tool_not_found`   | Tool name doesn't exist in the registry                                                           |
| `mcp.output_invalid`   | Tool handler produced output that failed `outputSchema`                                           |
| `mcp.bad_input`        | Input failed `inputSchema` or tool-specific validation (e.g. `target` on non-rate `ent_feedback`) |

Plugin-emitted errors during `ext_*` calls keep their `plugin.<plugin_id>.<code>` namespace per the error doc. The MCP dispatcher passes them through unchanged — it doesn't rewrap or rename.

### Capture

Follows the same "bugs get captured, expected product behavior doesn't" rule as the error-management doc's oRPC middleware:

- **Captured as `error`:** throws inside tool handlers, `mcp.output_invalid`, plugin-runtime errors during `ext_*` calls (already captured by the existing plugin-runtime capture path, now with the MCP request ID threaded in).
- **Not captured:** `mcp.invalid_id`, `mcp.forbidden`, `mcp.ambiguous_target`, `mcp.target_not_found`, `mcp.not_connected`, `mcp.bad_input`, `mcp.rate_limited`. All of these are expected product behavior — the agent passed something wrong, the user hasn't connected something, etc.

The capture call signature is the same:

```ts
await captureError(err, {
  severity: "error",
  source: "backend",
  route: `mcp:${toolName}`,
  userId,
  pluginId, // set for ext_* errors via the existing plugin-runtime capture path
  connectionId, // same
  context: { toolName, input: scrubbedInput },
});
```

### Request ID propagation

The MCP handler middleware reads the `X-Request-Id` header if present (for correlation with clients that set one) or generates a new UUID. It's set into AsyncLocalStorage before `dispatchTool` runs. From there:

- `captureError` reads it (existing behavior).
- The plugin runtime inherits it via the call path into `MediaService` (existing behavior from docs 1 & 2).
- The dispatcher stamps it onto `UserFacingError` before returning to the client.

A user can quote a reference ID back to an admin; the admin viewer at `/admin/errors` supports search by request ID and shows the full chain.

### Scrubber

No new patterns needed. Tool input doesn't contain credentials by construction — the agent never sees credentials. The existing scrubber in `server/errors/scrubber.ts` handles the rest.

## Schema additions

No new database tables. Two additions to existing structures:

### Plugin manifest

```ts
interface PluginManifest {
  // ... existing
  mcpTools?: Array<McpToolDefinition>;
}
```

Stored as part of the existing `plugins.manifest` JSON column.

### Capability definition

```ts
interface Capability {
  // ... existing
  mcpTools?: Array<McpToolDefinition>;
}
```

Capability definitions are host-side code, not stored in the database. No migration.

### `HOST_ERROR_CODES`

Adds the `mcp.*` codes listed in §7.2. English templates live in `locales/en/errors.json`.

## Layout

```
server/
├── mcp/
│   ├── index.ts                      # registerMcpRoutes(app)
│   ├── registry.ts                   # tool registry, lifecycle
│   ├── dispatch.ts                   # input/output validation, scope check, error shaping
│   ├── scopes.ts                     # MCP_SCOPES, MCP_DEFAULT_SCOPES
│   ├── rate-limit.ts                 # per-user token bucket
│   ├── composite-tools/
│   │   ├── ent-discover.ts           # handler + schema
│   │   ├── ent-activity.ts
│   │   └── ent-feedback.ts
│   ├── host-tools/
│   │   └── ent-account.ts            # read-only, host-owned
│   ├── tool-handlers/                # referenced from capability mcpTools fields
│   │   ├── ent-details.ts            # used by metadata-v1
│   │   └── ent-request.ts            # used by mediaRequest-v1
│   ├── response-shapes.ts            # MediaItem → compact response, truncation
│   ├── extension-dispatch.ts         # wrapper for MediaService.callExtension
│   └── errors.ts                     # MCP-specific UserFacingError constructors
├── routes/
│   ├── mcp.ts                        # Hono route: app.all("/api/mcp", mcpHandler(...))
│   └── well-known.ts                 # OAuth/OIDC discovery endpoints
├── media-service/
│   └── call-extension.ts             # new MediaService.callExtension method
├── capabilities/
│   ├── metadata-v1.ts                # revised: adds mcpTools, discover method
│   ├── media-request-v1.ts           # revised: adds mcpTools
│   ├── recommendations-v1.ts         # revised: adds getTrending method
│   └── ... other capabilities unchanged
└── errors/
    └── codes.ts                      # revised: adds mcp.* codes to HOST_ERROR_CODES

sdk/
├── plugin-sdk.d.ts                   # regenerated: mcpTools manifest field, MCPToolAnnotations
└── scripts/
    └── generate.ts                   # updated to emit MCP tool types

docs/
└── plugin-authoring-guide.md         # revised: when to use ext_* vs capability

locales/
└── en/
    └── errors.json                   # adds mcp.* English templates
```

One note on `ent_details` and `ent_request` handlers: they are _referenced_ by capability definitions but live in `server/mcp/tool-handlers/` rather than inside the capability file. The capability file imports and references; the handler file is a regular module. This keeps capability definitions focused on the host→plugin contract and tool handlers focused on the MCP→host translation.

## Testing

### MCP tool unit tests

One test file per tool or composite, exercising each code path with a mocked `MediaService`:

- **`ent_discover`** — one test per `mode`, each verifying the right MediaService method is called with translated input and the response is compressed correctly. Empty-result cases return `mcp.not_connected`.
- **`ent_details`** — verifies the four-way parallel fan-out; truncation to top-3 cast, top-8 keywords; TV-show progress inclusion.
- **`ent_request`** — `create` with `target` absent and 0/1/2 eligible connections (verifying `mcp.ambiguous_target` populates candidates for the 2-case); `create` with `target` pointing to a wrong-capability connection (`mcp.target_not_found`); `status` with and without `target`.
- **`ent_activity`** — one test per `view`, routing to the right capability.
- **`ent_feedback`** — each `action`; `rate` with `target` absent (writes all) and with `target` (writes one); non-rate actions with `target` produce `mcp.bad_input`; partial-success from one failing rating plugin doesn't fail the whole call.
- **`ent_account`** — populates `missing_capabilities` based on registry; reflects `is_default_for_capability` correctly.

### Registry tests

- Capability-owned tools register on host startup regardless of plugins installed.
- Composite tools register unconditionally.
- `ext_*` tools register on plugin install/enable; unregister on disable/uninstall.
- Name collision (two capabilities declaring the same `ent_*` name) fails startup with a clear message.
- Manifest validation at install: name charset, length cap, per-plugin count cap (5), description length cap.

### Scope enforcement tests

- Tool requiring `mcp.write.request` returns `mcp.forbidden` when JWT scope is `mcp.read` only.
- Multi-scope tools require all scopes.
- `mcp.forbidden` carries the missing scope list in `details`.

### Auth integration tests

- Valid JWT → tool call succeeds; `userId` populated from `sub`.
- Expired JWT → 401 with `WWW-Authenticate` pointing at the OAuth server per the MCP spec.
- Missing JWT → 401, same.
- Invalid issuer/audience → 401.
- Dynamically-registered public client can complete authorization and call tools.

### Error integration tests

- Tool handler throws → captured as `error` severity with `source: "backend"`, `route: "mcp:<tool>"`, correct request ID, correct user ID.
- Plugin-runtime error during `ext_*` → captured by the existing plugin-runtime path, request ID threaded from MCP correctly.
- Expected errors (`mcp.invalid_id`, `mcp.forbidden`, `mcp.ambiguous_target`, `mcp.not_connected`) → **not** captured.
- `mcp.output_invalid` → captured.
- Request ID propagates end-to-end: MCP call → MediaService → plugin runtime; errors at each stage correlate in the admin viewer.

### End-to-end MCP spec compliance

- MCP Inspector (`@modelcontextprotocol/inspector`) connects successfully against a running local instance.
- Full OAuth 2.1 authorization code + PKCE flow completes.
- `tools/list` returns all registered tools with correct schemas and descriptions.
- `tools/call` succeeds for one tool per category (capability-owned, composite, `ext_*`).

### Rate limiting

- User hits per-user limit → subsequent calls return `mcp.rate_limited` with `retry_after`.
- Bucket refills after window.

## Open questions / deferred

- **Per-tool user-level enable/disable.** Scopes govern what tools the agent can call; finer granularity ("my agent can use `ent_discover` but not `ent_feedback`") is not exposed in v1. If that proves insufficient, a per-user tool-enable table is added later.
- **Per-plugin `ext_*` scopes.** `mcp.ext` is one coarse scope in v1. Splitting per-plugin (`mcp.ext.trakt`, `mcp.ext.seerr`) is the natural next step if users want to install a plugin but not expose its tools.
- **Streaming tool responses.** MCP supports SSE streaming. None of the six tools need it in v1. When a tool is added that benefits from streaming, the transport already supports it; only the handler changes.
- **Personal access tokens.** Deferred. When added, PATs issue the same JWTs with the same scope structure; tool handlers don't change.
- **MCP Resources and Prompts.** The MCP spec defines `resources` and `prompts` alongside `tools`. v1 ships tools only; resources and prompts are added if a concrete use case appears (e.g. exposing a user's watchlist as a browsable resource).
- **Tool-level observability.** Success-path metrics (which tools are called, how often, by which clients) are out of scope per the error-doc's "product analytics is out of scope" stance. Revisit if operational needs demand it.
- **Alerting on MCP error volume.** Same deferral as the error doc — v1 surfaces counts, thresholds come later.
- **Plugin-contributed MCP resources.** If `ext_*` tools prove the plugin-extensibility model, plugin-contributed resources/prompts may follow. Not in v1.

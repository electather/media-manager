# MCP Server on Top of MediaService

**Status:** Draft for review
**Date:** 2026-04-19
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-frontend-connections-design.md`, `2026-04-19-error-management-design.md`
**Revises:** Adds `mcpTools` to capability definitions & plugin manifest (see §8)

## Summary

Designs MCP (Model Context Protocol) surface — how external agents (Claude Desktop, Claude Code, similar) reach user data & capabilities. Thin translation layer on top of `MediaService`: MCP handler verifies OAuth 2.1 JWT → looks up tool in registry → validates input → calls `MediaService` → compresses response → returns. No new dispatch, runtime, credential vault, or caching — MCP layer reuses what exists.

Follows token-efficiency discipline: small set of outcome-oriented tools, aggressive server-side enrichment & compression, consent-gated scope model. Six tools cover daily user workflows — discover, inspect, request, track, give feedback, see connected accounts — at ~3,900-token baseline for agent context. Plugins contribute namespaced `ext_*` tools for service-specific functionality without weakening outcome-oriented discipline of core surface.

## Goals

- Expose `MediaService` to MCP clients as small, token-efficient tool surface (6 outcome-oriented tools).
- Treat capability-level dispatch as source of truth — MCP tools know nothing about specific plugins.
- Reuse Better Auth's oauth-provider plugin for MCP spec-compliant authorization; no custom OAuth server.
- Allow plugins to contribute `ext_*` MCP tools sharing same runtime, auth & error-handling machinery.
- Produce errors in canonical `UserFacingError` shape from error-management doc; participate in existing capture pipeline.
- Keep door open to streaming responses, per-plugin scopes & PAT auth without requiring refactor.

## Non-goals

- Custom OAuth authorization server. Better Auth provides it.
- Personal access tokens (PATs) in v1. Deferred; when added → same JWTs with same scopes → tool handlers don't change.
- Streaming tool responses in v1. All 6 tools fit synchronous request/response.
- Embedding-based re-ranking internals. `ent_discover` in `recommend` mode calls preference engine via interface; engine design separate doc.
- Product analytics on tool calls. Out of scope per error-management doc.
- User-installable MCP clients outside OAuth flow. Dynamic client registration enabled; no other registration path in v1.

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
                │  • rate-limit check           │
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

MCP subsystem: 5 concerns, each distinct module:

- **Transport & auth.** Hono route wrapped by Better Auth's `mcpHandler`; well-known endpoints for discovery.
- **Tool registry.** In-memory, rebuilt on plugin lifecycle events; holds capability-owned, composite & `ext_*` tools uniformly.
- **Tool dispatcher.** Enforces per-user rate limit first, then validates input, checks scope, runs handlers, validates output, captures errors per error-management pipeline.
- **Tool handlers.** Pure translation between MCP surface & `MediaService`. No DB, no runtime, no auth — all below.
- **Response compression.** Pure functions shaping `MediaItem` & other `MediaService` outputs into compact agent-facing shapes.

Key point: **MCP layer adds no new infrastructure below itself.** Translates between MCP protocol & `MediaService`. Everything making plugins work — sandboxing, credential vaulting, capability registry, dispatch strategies, caching, error capture — already in place.

## Tool registry

Central data structure. Every exposed tool, regardless of declaration site, becomes uniform record:

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

`source` = internal metadata for logging & admin UI. Never exposed to MCP client. `outputSchema` also internal — MCP `tools/list` includes only `{ name, description, inputSchema, annotations }`.

### Three declaration sites

Tools enter registry from 3 places, all sharing record shape above.

**Capability-owned tools.** Capability definition gains optional `mcpTools` field:

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

Capability's Zod schemas remain source of truth for method inputs/outputs. MCP tool's JSON Schema authored separately — agent-facing contract shaped differently (e.g. `id` param is `"movie:550"` not `{ tmdb_id: "550", media_type: "movie" }`). Handler does translation.

Tools registered this way go live when capability registers in host, regardless of plugins. If no plugin implements `metadata@v1` & agent calls `ent_details` → handler receives empty dispatch result → returns `mcp.not_connected` with guidance. **Tools ⊥ hidden from `tools/list` based on installed plugins** — hiding changes agent's surface dynamically → more confusion than prevented.

**Composite tools.** Declared in host module, not in any capability:

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

Host has fixed, small set of composite tools. In v1: `ent_discover`, `ent_activity`, `ent_feedback`. Adding new composite = host code change, not configuration.

**Plugin `ext_*` tools.** Declared in plugin manifest:

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

Plugin exports `rescan(ctx, input)` alongside capability methods & job handlers. Host registers as `ext_trakt_rescan` with wrapper handler dispatching into plugin runtime via `MediaService.callExtension`.

### Validation at registration

Capability-owned & composite tools ! use names starting with `ext_`. Enforced at host startup; failure = fatal boot error.

Plugin `ext_*` tools subject to manifest-install validation:

- `name` matches `/^[a-z][a-z0-9_]*$/`.
- `name` length keeps prefixed full name (`ext_<plugin_id>_<name>`) ≤ 64 chars.
- `description` ≤ 400 chars; per-property descriptions in schemas ≤ 200 chars each.
- `handler` matches exported key on plugin's `mcpTools` object.
- `inputSchema` & `outputSchema` = valid JSON Schema (validated with `ajv`).
- Plugin's `mcpTools` array capped at 5 entries.

Length & count caps = design choice, not technical limit. Token-efficiency discipline has teeth: plugin authors wanting >5 tools → open issue, default answer = "make it capability."

### Lifecycle

Registry rebuilt on 3 events:

1. **Host startup.** All capability-owned & composite tools register immediately. Enabled plugins' `ext_*` tools register as each plugin's runtime boots.
2. **Plugin install/update/enable.** Plugin's `ext_*` tools added (or replaced on update).
3. **Plugin disable/uninstall.** Plugin's `ext_*` tools removed.

Capability-owned & composite tools ⊥ unregister during host's lifetime; tied to host's own code.

## The six tools

### Universal conventions

3 conventions apply across all 6 tools.

**Media IDs use TMDB as canonical surface.** Agent sees `"movie:550"` or `"tv:1396"`. Tool handlers parse → `{ tmdb_id, media_type }` for `MediaService`. TMDB canonical because Seerr uses TMDB IDs natively, TMDB coverage broadest, `MediaService`'s `id_map` resolves to other ID types when plugin needs — invisible to agent.

**Compact responses omit absent fields.** `user_rated`, `match_reason`, `watch_progress`, etc. ⊥ included when null or not applicable. JSON Schema marks optional. Compression, not optionality.

**Structured errors use `UserFacingError`.** ∀ tools return errors in canonical shape from error-management doc, with code-specific payloads under `details`:

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

Agent reads `devMessage` (English) & can use structured `details` to disambiguate (e.g. offer user choices → retry with `target: "conn_abc"`).

### `ent_discover` — composite

Outcome-oriented search, recommendations, similar titles, trending & filtered discovery. Composite because modes dispatch across different capabilities.

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

| Mode        | MediaService call                                                   | Notes                                                                 |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `search`    | `metadata@v1.search`                                                | Filters passed through where supported                                |
| `recommend` | `recommendations@v1.getRecommendations` + preference-engine re-rank | Merged results re-ranked against user's preference profile            |
| `similar`   | `metadata@v1.getSimilar`                                            | If `query` isn't id → handler first resolves via `metadata@v1.search` |
| `trending`  | `recommendations@v1.getTrending`                                    | New method on capability (non-breaking addition)                      |
| `discover`  | `metadata@v1.discover`                                              | New method on capability (non-breaking addition)                      |

Adding `getTrending` to `recommendations@v1` & `discover` to `metadata@v1` = backward-compatible additions: plugins not implementing them silently skipped in `aggregate`; in `primary_with_enrichment`, absence means feature unavailable for users whose primary doesn't support them. Avoids inventing `discovery@v1` mega-capability.

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

- `status` collapses `mediaRequest@v1.getStatus` output into one of `available`, `requested`, `processing`, `unavailable`, `unknown`. Batched per-page for result set.
- `user_rated` appears only when `ratings@v1.getRating` returns value (aggregated across rating plugins; most-recent wins per MediaService doc).
- `match_reason` appears only for `recommend` & `similar`, generated by preference engine during re-ranking.

`ent_discover` ⊥ accepts `target` param. All modes = read ops under `aggregate` | `primary_with_enrichment` strategies.

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

4 `MediaService` calls in parallel:

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

Truncation: top 3 cast, top 8 keywords. `ratings` object keys = plugin-identifying (`tmdb`, `trakt`, etc.) plus `user` for user's own rating. Right place to leak plugin identity — agent should know which service rating came from.

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
- User has >1 eligible connection & `target` omitted → `mcp.ambiguous_target` with `details.candidates`.
- `target` provided → `MediaService` routes to that specific connection.
- `target` points to connection not belonging to user | not implementing `mediaRequest@v1` → `mcp.target_not_found`.

**Dispatch for `action: "status"`:**

- Calls `mediaRequest@v1.listRequests` across all eligible connections (aggregate).
- `target` optional: filters to that connection if provided.

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

Views user's watchlist, history, upcoming episodes, or show progress. Composite because each view routes to different capability.

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

Response uses same `results` array shape as `ent_discover`, with availability resolved via `mediaRequest@v1.getStatus`.

### `ent_feedback` — composite

Records user preference signals. Composite because writes to host's `feedback_log` _and_ optionally to `ratings@v1` plugins.

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
2. Always: trigger preference-engine update for user (async; ⊥ block response).
3. `action: "rate"` only: write rating to `ratings@v1` plugins.
   - Default (no `target`): write to _all_ connected rating plugins. Ratings typically mirrored ("rate this 8" on Trakt & any other tracker).
   - With `target`: write only to specified connection.
   - One plugin failing ⊥ fail whole call — surfaces as partial result.
4. `action: "like" | "dislike" | "note"`: no plugin write. Preference-engine only.

`target` documented as applying only when `action=rate`. Other actions with `target` present → `mcp.bad_input` rather than silently ignoring — explicit error catches agent misunderstandings early.

Rating fan-out ≠ `aggregate` | `single` in strict sense — "broadcast" pattern. Rather than inventing new strategy for this single case, composite handler drives fan-out explicitly via `MediaService.setRating(userId, tmdbId, rating, { connectionIds })` with specific list. Keeps strategy vocabulary small (3 strategies) at cost of making this write explicit.

**Response:**

```json
{
  "recorded": true,
  "synced_to": ["conn_trakt"],
  "profile_update": "Decreased preference for slow-paced dramas"
}
```

`synced_to` empty for non-rate actions. `profile_update` = short human-readable description preference engine returns as side effect; agent can relay to user.

### `ent_account` — host-owned, read-only

```json
{
  "name": "ent_account",
  "description": "List your connected services, their status, and what they provide.",
  "inputSchema": { "type": "object", "properties": {} },
  "requiredScopes": ["mcp.read"]
}
```

Reads from existing `service_connections` table (already user-scoped via `account:connections` permission model) & capability registry.

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

`missing_capabilities` lists capabilities host knows about but user has no connected plugin. Agent can guide user ("you haven't connected anything providing upcoming episodes").

Read-only. Agent encounters `mcp.not_connected` from another tool → can call `ent_account` to see what's available.

## Plugin `ext_*` tools

Plugin-contributed tools for plugin-specific functionality not fitting capability. Namespaced `ext_<plugin_id>_<name>` to prevent collision & signal to agent that tool = service-specific.

### Manifest declaration

New optional `mcpTools` field on plugin manifest:

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

Validation rules in §3 (Tool registry).

### Plugin entry point

Plugin exports `mcpTools` object alongside `capabilities` & `jobs`:

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

Handlers receive same `PluginContext<TCred, TUserCfg, TGlobalCfg>` that capability methods receive. Same runtime, same sandbox, same `ctx.fetch` allowlist, same rate limits.

### Dispatch

Registered tool record for `ext_*` tool has handler calling:

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

`callExtension` = single new method on `MediaService`. It:

1. Resolves connections for plugin (single-or-shared, same path as capability calls).
2. Picks default connection (or shared-credentials entry). Strategy always `single` for `ext_*` tools; multiple connections exist & no `target` → `mcp.ambiguous_target`.
3. Builds `PluginContext`.
4. Invokes `plugin.mcpTools[handlerName](ctx, input)` via runtime.
5. Validates output against tool's `outputSchema`.
6. Normalizes errors through same retry-and-status-update path as capability calls.
7. Returns result.

### Constraints inherited from sandbox

Extension tool ⊥ call other plugins, ⊥ touch DB, ⊥ use `setTimeout`/`setInterval`, ⊥ run dynamic code, ⊥ hit hosts outside `manifest.allowedHosts`. Runs within plugin's 15s timeout & memory cap. Plugin author wants to orchestrate multiple capabilities → answer = "propose composite tool for host," not "give plugins more power."

### No cache, no id_map harvest

Extension tools ⊥ use `MediaService` cache. Capability calls cache because identical calls for same user return same data; extension tools = arbitrary plugin operations with no consistent shape. Plugins can cache internally via `ctx.store`.

`id_map` harvesting ⊥ applies. Harvesting works because capability responses have known schema (`MediaItem` with `ids` field); extension outputs arbitrary.

### Guidance for plugin authors

New section in plugin-authoring guide:

- Functionality ∈ "any user of similar service would want" → propose new capability.
- Functionality ∈ "specific to plugin, ⊥ makes sense for other services" (e.g. Trakt-specific scrobble override, Seerr-specific request-queue management, plugin-local cache reset) → `ext_*` tool.
- When unsure → probably capability.

Host ⊥ mechanically reject `ext_*` tools that "should have been capabilities." 5-tool-per-plugin cap = only real pressure; everything else editorial.

## Transport, auth & wiring

### Endpoint

Streamable HTTP MCP at `/api/mcp`, handled by `mcp-handler` package wrapped by Better Auth's `mcpHandler`:

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

`dispatchTool` = shim running ajv input validation, checks scopes, invokes handler, runs ajv output validation & converts thrown errors into `UserFacingError` shapes. Sets MCP request ID into AsyncLocalStorage so downstream error captures correlate.

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
  clientRegistrationAllowedScopes: MCP_SCOPES,
});
```

`allowUnauthenticatedClientRegistration` lets Claude Desktop, Cursor & similar clients self-register as public clients on first connect. Without it → each client needs manually-registered `client_id`, defeating "paste URL" UX those clients assume.

**Dynamic client lifecycle & cleanup.** A self-registered client is ownerless (`oauth_client.user_id IS NULL`) until a user authorizes it, at which point an `oauth_consent` row is written. Honest clients complete this handshake in minutes. Abandoned registrations (probes, retries, abuse behind rotating IPs) would otherwise accumulate forever, since the per-IP rate limit caps registration rate but not total table size. A scheduled sweep (`host.auth.stale_client_sweep`, `auth/jobs/stale-client-sweep.ts`, hourly) deletes any client that is still ownerless, still has no consent row, and is older than the TTL (24h). Cascade deletes on `client_id` reclaim orphaned token rows. The sweep can never touch an owned client (deliberately provisioned, e.g. one with `skip_consent`, which `z.never()` blocks at the dynamic-registration endpoint so it is always owner-created) or a consented one. See `docs/2026-04-20-job-service-design.md` for the job enumeration.

### Well-known endpoints

3 Hono routes, one-liners per Better Auth's conventions:

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

Scopes express "what can agent do on behalf of user." Vocabulary deliberately coarse & outcome-oriented — aligned to tools, not capabilities | plugins. 4 scopes:

| Scope                | Tools granted                                                |
| -------------------- | ------------------------------------------------------------ |
| `mcp.read`           | `ent_discover`, `ent_details`, `ent_activity`, `ent_account` |
| `mcp.write.feedback` | `ent_feedback`                                               |
| `mcp.write.request`  | `ent_request` (`create` & `status`)                          |
| `mcp.ext`            | All `ext_*` tools                                            |

Defaults for dynamically-registered clients: `mcp.read` & `mcp.write.feedback`. Clients request additional scopes at authorization time; user sees consent screen & approves.

∀ `RegisteredTool` declares `requiredScopes`. Dispatcher checks `jwt.scope` before invoking handler. Missing scope → `mcp.forbidden` with `details.missing_scopes` so agent can prompt user to re-authorize.

**Why scope granularity coarse.** Per-capability | per-plugin scopes → ~20 scopes & consent screen nobody reads. Coarse outcome-oriented scopes match tool design & user's mental model. Finer-grained authorization, if needed, lives at connection level (already covered by `account:connections` from plugin architecture doc).

**Why `mcp.ext` = one scope in v1.** `ext_*` tools = plugin-specific & unpredictable at design time. Either user trusts agent to call plugin-specific tools or not; splitting per-plugin explodes consent screen on every plugin install.

### Session state

Stateless at app level. MCP session IDs live in Postgres & Redis via `CacheProvider` configured (Redis for multi-instance), handled internally by `mcp-handler` package.

### Rate limiting

2 layers:

1. **Better Auth's built-in per-IP rate limiting** on OAuth endpoints (`/oauth2/token`, `/oauth2/authorize`, etc.). Dynamic client registration is capped tighter than the default (5/hour per IP, see `auth/internal/config.ts`) since it is an unauthenticated write. This bounds registration _rate_ but not total table size, so it is paired with the stale-client sweep (see §OAuth server): an attacker behind rotating IPs could otherwise register unbounded never-used clients, and the hourly sweep reclaims any left unauthorized past the TTL.
2. **Per-user MCP rate limiting** on `/api/mcp`: token bucket keyed by JWT `sub`, default 60 tool calls per minute, configurable via env. Excess → `mcp.rate_limited` with `retry_after` param. Limiter is the first gate in `dispatchTool` — `mcp.tool_not_found` and `mcp.forbidden` paths also consume a token so unknown-tool or missing-scope traffic cannot bypass the bucket.

Per-user limit prevents over-eager agent from hammering server (& transitively external APIs). Per-external-API rate limits remain responsibility of each plugin's `ctx.fetch` enforcement.

### CORS

`/.well-known/*` endpoints have permissive CORS for local testing with MCP Inspector (documented by Better Auth). `/api/mcp` does not — MCP clients ⊥ browsers.

## Error handling

MCP layer participates in error-management pipeline from error-management doc. No new machinery.

### Wire format

∀ tool errors conform to `UserFacingError`:

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

MCP dispatcher adds `requestId` from AsyncLocalStorage before returning.

### New MCP-specific codes

Added to `HOST_ERROR_CODES` (adding code forces translation entry, preserving error-doc's discipline):

| Code                   | When                                                                        |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `mcp.ambiguous_target` | `single`-strategy write with >1 eligible connection & no `target`           |
| `mcp.target_not_found` | `target` provided but ∉ valid connection of user                            | doesn't support capability                                          |
| `mcp.forbidden`        | JWT scope doesn't grant required tool scope                                 |
| `mcp.invalid_id`       | Malformed media id                                                          |
| `mcp.not_connected`    | Capability has 0 connections; tool returns structured "no sources" response |
| `mcp.rate_limited`     | Per-user MCP rate limit exceeded                                            |
| `mcp.tool_not_found`   | Tool name ∉ registry                                                        |
| `mcp.output_invalid`   | Tool handler produced output failing `outputSchema`                         |
| `mcp.bad_input`        | Input failed `inputSchema`                                                  | tool-specific validation (e.g. `target` on non-rate `ent_feedback`) |

Plugin-emitted errors during `ext_*` calls keep `plugin.<plugin_id>.<code>` namespace per error doc. MCP dispatcher passes through unchanged — ⊥ rewrap | rename.

### Capture

Follows same "bugs get captured, expected product behavior doesn't" rule as error-management doc's RPC middleware:

- **Captured as `error`:** throws inside tool handlers, `mcp.output_invalid`, plugin-runtime errors during `ext_*` calls (already captured by existing plugin-runtime capture path, now with MCP request ID threaded in).
- **⊥ captured:** `mcp.invalid_id`, `mcp.forbidden`, `mcp.ambiguous_target`, `mcp.target_not_found`, `mcp.not_connected`, `mcp.bad_input`, `mcp.rate_limited`. All = expected product behavior — agent passed something wrong, user hasn't connected something, etc.

Capture call signature:

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

MCP handler middleware reads `X-Request-Id` header if present (correlation with clients that set one) | generates new UUID. Set into AsyncLocalStorage before `dispatchTool` runs. From there:

- `captureError` reads it (existing behavior).
- Plugin runtime inherits it via call path into `MediaService` (existing behavior from docs 1 & 2).
- Dispatcher stamps it onto `UserFacingError` before returning to client.

User can quote reference ID back to admin; admin viewer at `/admin/errors` supports search by request ID & shows full chain.

### Scrubber

No new patterns needed. Tool input ⊥ contain credentials by construction — agent ⊥ sees credentials. Existing scrubber in `server/errors/scrubber.ts` handles rest.

## Schema additions

No new DB tables. 2 additions to existing structures:

### Plugin manifest

```ts
interface PluginManifest {
  // ... existing
  mcpTools?: Array<McpToolDefinition>;
}
```

Stored as part of existing `plugins.manifest` JSON column.

### Capability definition

```ts
interface Capability {
  // ... existing
  mcpTools?: Array<McpToolDefinition>;
}
```

Capability definitions = host-side code, ⊥ stored in DB. No migration.

### `HOST_ERROR_CODES`

Adds `mcp.*` codes listed in §7.2. English templates live in `locales/en/errors.json`.

## Layout

```
server/
├── mcp/
│   ├── index.ts                      # registerMcpRoutes(app)
│   ├── registry.ts                   # tool registry, lifecycle
│   ├── dispatch.ts                   # input/output validation, scope check, error shaping
│   ├── scopes.ts                     # MCP_SCOPES
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

`ent_details` & `ent_request` handlers _referenced_ by capability definitions but live in `server/mcp/tool-handlers/` rather than inside capability file. Capability file imports & references; handler file = regular module. Keeps capability definitions focused on host→plugin contract & tool handlers focused on MCP→host translation.

## Testing

### MCP tool unit tests

1 test file per tool | composite, exercising each code path with mocked `MediaService`:

- **`ent_discover`** — 1 test per `mode`, each verifying right `MediaService` method called with translated input & response compressed correctly. Empty-result cases → `mcp.not_connected`.
- **`ent_details`** — verifies 4-way parallel fan-out; truncation to top-3 cast, top-8 keywords; TV-show progress inclusion.
- **`ent_request`** — `create` with `target` absent & 0/1/2 eligible connections (verifying `mcp.ambiguous_target` populates candidates for 2-case); `create` with `target` pointing to wrong-capability connection (`mcp.target_not_found`); `status` with & without `target`.
- **`ent_activity`** — 1 test per `view`, routing to right capability.
- **`ent_feedback`** — each `action`; `rate` with `target` absent (writes all) & with `target` (writes one); non-rate actions with `target` → `mcp.bad_input`; partial-success from one failing rating plugin ⊥ fail whole call.
- **`ent_account`** — populates `missing_capabilities` based on registry; reflects `is_default_for_capability` correctly.

### Registry tests

- Capability-owned tools register on host startup regardless of plugins installed.
- Composite tools register unconditionally.
- `ext_*` tools register on plugin install/enable; unregister on disable/uninstall.
- Name collision (2 capabilities declaring same `ent_*` name) fails startup with clear message.
- Manifest validation at install: name charset, length cap, per-plugin count cap (5), description length cap.

### Scope enforcement tests

- Tool requiring `mcp.write.request` returns `mcp.forbidden` when JWT scope = `mcp.read` only.
- Multi-scope tools require all scopes.
- `mcp.forbidden` carries missing scope list in `details`.

### Auth integration tests

- Valid JWT → tool call succeeds; `userId` populated from `sub`.
- Expired JWT → 401 with `WWW-Authenticate` pointing at OAuth server per MCP spec.
- Missing JWT → 401, same.
- Invalid issuer/audience → 401.
- Dynamically-registered public client can complete authorization & call tools.

### Error integration tests

- Tool handler throws → captured as `error` severity with `source: "backend"`, `route: "mcp:<tool>"`, correct request ID, correct user ID.
- Plugin-runtime error during `ext_*` → captured by existing plugin-runtime path, request ID threaded from MCP correctly.
- Expected errors (`mcp.invalid_id`, `mcp.forbidden`, `mcp.ambiguous_target`, `mcp.not_connected`) → **⊥ captured**.
- `mcp.output_invalid` → captured.
- Request ID propagates end-to-end: MCP call → `MediaService` → plugin runtime; errors at each stage correlate in admin viewer.

### End-to-end MCP spec compliance

- MCP Inspector (`@modelcontextprotocol/inspector`) connects successfully against running local instance.
- Full OAuth 2.1 authorization code + PKCE flow completes.
- `tools/list` returns all registered tools with correct schemas & descriptions.
- `tools/call` succeeds for 1 tool per category (capability-owned, composite, `ext_*`).

### Rate limiting

- User hits per-user limit → subsequent calls return `mcp.rate_limited` with `retry_after`.
- Bucket refills after window.

## Open questions / deferred

- **Per-tool user-level enable/disable.** Scopes govern what tools agent can call; finer granularity ("agent can use `ent_discover` but not `ent_feedback`") ⊥ exposed in v1. If insufficient → per-user tool-enable table added later.
- **Per-plugin `ext_*` scopes.** `mcp.ext` = one coarse scope in v1. Splitting per-plugin (`mcp.ext.trakt`, `mcp.ext.seerr`) = natural next step if users want plugin installed but ⊥ expose its tools.
- **Streaming tool responses.** MCP supports SSE streaming. None of 6 tools need it in v1. When tool added benefiting from streaming → transport already supports it; only handler changes.
- **Personal access tokens.** Deferred. When added → PATs issue same JWTs with same scope structure; tool handlers ⊥ change.
- **MCP Resources & Prompts.** MCP spec defines `resources` & `prompts` alongside `tools`. v1 ships tools only; resources & prompts added if concrete use case appears (e.g. exposing user's watchlist as browsable resource).
- **Tool-level observability.** Success-path metrics (which tools called, how often, by which clients) out of scope per error-doc. Revisit if operational needs demand.
- **Alerting on MCP error volume.** Same deferral as error doc — v1 surfaces counts, thresholds later.
- **Plugin-contributed MCP resources.** If `ext_*` tools prove plugin-extensibility model → plugin-contributed resources/prompts may follow. ⊥ in v1.

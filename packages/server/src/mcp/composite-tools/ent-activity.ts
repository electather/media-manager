import { dispatchAggregate } from "../../media/dispatcher";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import { compactList, type AvailabilityStatus, type CompactMediaResult } from "../response-shapes";
import { badInput, notConnected } from "../errors";
import type { ToolCallContext, ToolHandler, ToolRegistration } from "../registry";

type ActivityView = "watchlist" | "history" | "upcoming" | "progress";

interface EntActivityInput {
  view?: ActivityView;
  media_type?: "movie" | "tv" | "any";
  limit?: number;
}

interface ActivityResponse {
  results: Array<CompactMediaResult & { watched_at?: string; airs_at?: string; progress?: number }>;
  total: number;
  has_more: boolean;
}

interface AvailabilityRow {
  status?: AvailabilityStatus;
}

function resolveMediaType(raw: EntActivityInput["media_type"]): "movie" | "tv" | undefined {
  if (!raw || raw === "any") return undefined;
  return raw;
}

function filterByType<T extends { item?: { type?: "movie" | "tv" } }>(
  rows: T[],
  type: "movie" | "tv" | undefined,
): T[] {
  if (!type) return rows;
  return rows.filter((r) => !r.item?.type || r.item.type === type);
}

async function decorateAvailability(
  userId: string,
  results: CompactMediaResult[],
): Promise<Map<string, AvailabilityStatus>> {
  const providers = capabilityRegistry.listProviders("mediaRequest", "v1");
  if (providers.length === 0 || results.length === 0) return new Map();
  const map = new Map<string, AvailabilityStatus>();
  await Promise.all(
    results.map(async (item) => {
      const [type, tmdbId] = item.id.split(":");
      if (!type || !tmdbId) return;
      try {
        const result = await dispatchAggregate<AvailabilityRow[]>({
          userId,
          capability: "mediaRequest",
          version: "v1",
          method: "checkAvailability",
          input: { tmdbId, type: type as "movie" | "tv" },
        });
        const first = (result.data ?? []).find((row) => row && row.status);
        if (first?.status) map.set(item.id, first.status);
      } catch {
        // Best-effort.
      }
    }),
  );
  return map;
}

async function runWatchlist(
  ctx: ToolCallContext,
  input: EntActivityInput,
): Promise<ActivityResponse["results"]> {
  const providers = capabilityRegistry.listProviders("watchlist", "v1");
  if (providers.length === 0) throw notConnected("watchlist@v1");
  const type = resolveMediaType(input.media_type);
  const result = await dispatchAggregate<Array<{ item: unknown; addedAt?: string }>>({
    userId: ctx.userId,
    capability: "watchlist",
    version: "v1",
    method: "getWatchlist",
    input: type ? { type } : {},
  });
  const filtered = filterByType(
    (result.data ?? []) as Array<{ item: { type?: "movie" | "tv" }; addedAt?: string }>,
    type,
  );
  return compactList(filtered, () => ({}), input.limit);
}

async function runHistory(
  ctx: ToolCallContext,
  input: EntActivityInput,
): Promise<ActivityResponse["results"]> {
  const providers = capabilityRegistry.listProviders("watchHistory", "v1");
  if (providers.length === 0) throw notConnected("watchHistory@v1");
  const type = resolveMediaType(input.media_type);
  const result = await dispatchAggregate<
    Array<{ item: { type?: "movie" | "tv" }; watchedAt?: string; progress?: number }>
  >({
    userId: ctx.userId,
    capability: "watchHistory",
    version: "v1",
    method: "getHistory",
    input: { limit: input.limit ?? 15 },
  });
  const filtered = filterByType(result.data ?? [], type);
  const compacted = compactList(filtered, () => ({}), input.limit);
  return compacted.map((row, idx) => {
    const source = filtered[idx];
    const extras: { watched_at?: string; progress?: number } = {};
    if (typeof source?.watchedAt === "string") extras.watched_at = source.watchedAt;
    if (typeof source?.progress === "number") extras.progress = source.progress;
    return { ...row, ...extras };
  });
}

async function runUpcoming(
  ctx: ToolCallContext,
  input: EntActivityInput,
): Promise<ActivityResponse["results"]> {
  const providers = capabilityRegistry.listProviders("calendar", "v1");
  if (providers.length === 0) throw notConnected("calendar@v1");
  const result = await dispatchAggregate<
    Array<{ item: { type?: "movie" | "tv" }; airsAt?: string }>
  >({
    userId: ctx.userId,
    capability: "calendar",
    version: "v1",
    method: "getUpcoming",
    input: {},
  });
  const type = resolveMediaType(input.media_type);
  const filtered = filterByType(result.data ?? [], type);
  const compacted = compactList(filtered, () => ({}), input.limit);
  return compacted.map((row, idx) => {
    const source = filtered[idx];
    return {
      ...row,
      ...(typeof source?.airsAt === "string" ? { airs_at: source.airsAt } : {}),
    };
  });
}

async function runProgress(
  ctx: ToolCallContext,
  input: EntActivityInput,
): Promise<ActivityResponse["results"]> {
  const providers = capabilityRegistry.listProviders("watchHistory", "v1");
  if (providers.length === 0) throw notConnected("watchHistory@v1");
  // Progress is a host-side aggregation over watchHistory — surface the most
  // recent TV rows as "in progress" when they reported partial progress.
  const result = await dispatchAggregate<
    Array<{ item: { type?: "movie" | "tv" }; progress?: number; watchedAt?: string }>
  >({
    userId: ctx.userId,
    capability: "watchHistory",
    version: "v1",
    method: "getHistory",
    input: { limit: (input.limit ?? 15) * 3 },
  });
  const type = resolveMediaType(input.media_type) ?? "tv";
  const inProgress = (result.data ?? []).filter(
    (row) =>
      row.item?.type === type &&
      typeof row.progress === "number" &&
      row.progress > 0 &&
      row.progress < 1,
  );
  const compacted = compactList(inProgress, () => ({}), input.limit);
  return compacted.map((row, idx) => {
    const source = inProgress[idx];
    return {
      ...row,
      ...(typeof source?.progress === "number" ? { progress: source.progress } : {}),
      ...(typeof source?.watchedAt === "string" ? { watched_at: source.watchedAt } : {}),
    };
  });
}

export const entActivityHandler: ToolHandler = async (ctx, rawInput) => {
  const input = (rawInput ?? {}) as EntActivityInput;
  const view: ActivityView = input.view ?? "watchlist";
  let results: ActivityResponse["results"];
  switch (view) {
    case "watchlist":
      results = await runWatchlist(ctx, input);
      break;
    case "history":
      results = await runHistory(ctx, input);
      break;
    case "upcoming":
      results = await runUpcoming(ctx, input);
      break;
    case "progress":
      results = await runProgress(ctx, input);
      break;
    default:
      throw badInput("ent_activity", `unknown view ${String(view)}`);
  }

  const limit = input.limit ?? 15;
  const availability = await decorateAvailability(ctx.userId, results);
  const decorated = results.map((row) => {
    const status = availability.get(row.id);
    return status && status !== "unknown" ? { ...row, status } : row;
  });

  const response: ActivityResponse = {
    results: decorated.slice(0, limit),
    total: decorated.length,
    has_more: decorated.length > limit,
  };
  return response;
};

export const entActivityRegistration: Omit<ToolRegistration, "source"> & { id: string } = {
  id: "ent_activity",
  name: "ent_activity",
  description: "View your watchlist, recent watch history, upcoming episodes, or show progress.",
  inputSchema: {
    type: "object",
    properties: {
      view: {
        type: "string",
        enum: ["watchlist", "history", "upcoming", "progress"],
        default: "watchlist",
      },
      media_type: { type: "string", enum: ["movie", "tv", "any"], default: "any" },
      limit: { type: "integer", default: 15, maximum: 100 },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    additionalProperties: true,
  },
  requiredScopes: ["mcp.read"],
  annotations: { readOnlyHint: true },
  handler: entActivityHandler,
};

import {
  dispatchToConnection,
  listEligibleConnections,
  dispatchAggregate,
  type EligibleConnection,
} from "../../media";
import type { ToolCallContext, ToolHandler } from "../registry";
import { parseMediaId } from "../media-id";
import { ambiguousTarget, badInput, notConnected, targetNotFound } from "../errors";

type RequestAction = "create" | "status";

interface EntRequestInput {
  action?: RequestAction;
  id?: string;
  seasons?: string;
  target?: string;
}

interface CreateRequestResult {
  success: boolean;
  requestId?: string;
  message?: string;
}

interface ListedRequest {
  id: string;
  tmdbId: string;
  type: "movie" | "tv";
  title: string;
  status: "pending" | "approved" | "processing" | "available" | "failed";
  createdAt: string;
}

interface EntRequestCreateResponse {
  action: "create";
  target: {
    connection_id: string;
    display_name: string | null;
  };
  success: boolean;
  request_id?: string;
  message?: string;
}

interface EntRequestStatusResponse {
  action: "status";
  requests: Array<{
    id: string;
    tmdb_id: string;
    type: "movie" | "tv";
    title: string;
    status: ListedRequest["status"];
    created_at: string;
    connection_id: string;
  }>;
}

function describeCandidates(candidates: EligibleConnection[]) {
  return candidates.map((c) => ({
    connection_id: c.connectionId,
    display_name: c.displayName,
    plugin_id: c.pluginId,
  }));
}

// fallow-ignore-next-line complexity
function pickTarget(
  candidates: EligibleConnection[],
  target: string | undefined,
): EligibleConnection {
  if (target) {
    const match = candidates.find((c) => c.connectionId === target);
    if (!match) throw targetNotFound(target, "mediaRequest@v1");
    return match;
  }
  if (candidates.length === 1) return candidates[0]!;
  const defaults = candidates.filter((c) => c.isDefault);
  if (defaults.length === 1) return defaults[0]!;
  throw ambiguousTarget("mediaRequest@v1", describeCandidates(candidates));
}

// fallow-ignore-next-line complexity
async function handleCreate(
  ctx: ToolCallContext,
  input: EntRequestInput,
): Promise<EntRequestCreateResponse> {
  if (!input.id) throw badInput("ent_request", "id is required when action=create");
  const parsed = parseMediaId(input.id);

  const candidates = await listEligibleConnections(ctx.userId, "mediaRequest", "v1");
  if (candidates.length === 0) throw notConnected("mediaRequest@v1");

  const target = pickTarget(candidates, input.target);

  const result = await dispatchToConnection<CreateRequestResult>({
    userId: ctx.userId,
    connectionId: target.connectionId,
    capability: "mediaRequest",
    version: "v1",
    method: "createRequest",
    input: {
      tmdbId: parsed.tmdbId,
      type: parsed.type,
      ...(input.seasons ? { seasons: input.seasons } : {}),
    },
  });

  return {
    action: "create",
    target: {
      connection_id: target.connectionId,
      display_name: target.displayName,
    },
    success: result?.success ?? false,
    ...(result?.requestId ? { request_id: result.requestId } : {}),
    ...(result?.message ? { message: result.message } : {}),
  };
}

// fallow-ignore-next-line complexity
async function handleStatus(
  ctx: ToolCallContext,
  input: EntRequestInput,
): Promise<EntRequestStatusResponse> {
  const candidates = await listEligibleConnections(ctx.userId, "mediaRequest", "v1");
  if (candidates.length === 0) throw notConnected("mediaRequest@v1");

  const pool = input.target
    ? candidates.filter((c) => c.connectionId === input.target)
    : candidates;
  if (input.target && pool.length === 0) throw targetNotFound(input.target, "mediaRequest@v1");

  if (pool.length === 1) {
    const target = pool[0]!;
    const rows =
      (await dispatchToConnection<ListedRequest[]>({
        userId: ctx.userId,
        connectionId: target.connectionId,
        capability: "mediaRequest",
        version: "v1",
        method: "listRequests",
        input: {},
      })) ?? [];
    return {
      action: "status",
      requests: rows.map((r) => ({
        id: r.id,
        tmdb_id: r.tmdbId,
        type: r.type,
        title: r.title,
        status: r.status,
        created_at: r.createdAt,
        connection_id: target.connectionId,
      })),
    };
  }

  // No target specified and multiple eligible connections — aggregate across
  // all of them so the caller sees every outstanding request.
  const result = await dispatchAggregate<ListedRequest[]>({
    userId: ctx.userId,
    capability: "mediaRequest",
    version: "v1",
    method: "listRequests",
    input: {},
  });
  return {
    action: "status",
    requests: (result.data ?? []).map((r) => ({
      id: r.id,
      tmdb_id: r.tmdbId,
      type: r.type,
      title: r.title,
      status: r.status,
      created_at: r.createdAt,
      connection_id: "",
    })),
  };
}

export const entRequestHandler: ToolHandler = async (ctx, rawInput) => {
  const input = (rawInput ?? {}) as EntRequestInput;
  const action: RequestAction = input.action ?? "status";
  if (action === "create") return handleCreate(ctx, input);
  return handleStatus(ctx, input);
};

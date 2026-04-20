import { randomUUID } from "node:crypto";
import { consola } from "consola";
import { getDb } from "../../db/client";
import { feedback } from "../../db/schema";
import {
  dispatchToConnection,
  listEligibleConnections,
  type EligibleConnection,
} from "../../media/connection-targeted";
import { dispatchPrimary } from "../../media/dispatcher";
import { extractSignals } from "../../preferences/signals";
import type { ToolHandler, ToolRegistration } from "../registry";
import { parseMediaId } from "../media-id";
import { badInput, targetNotFound } from "../errors";

type FeedbackAction = "like" | "dislike" | "rate" | "note";

interface EntFeedbackInput {
  id: string;
  action: FeedbackAction;
  rating?: number;
  note?: string;
  target?: string;
}

interface FeedbackResponse {
  recorded: boolean;
  synced_to: string[];
  sync_errors?: Array<{ connection_id: string; message: string }>;
}

function pickTargets(
  candidates: EligibleConnection[],
  target: string | undefined,
): EligibleConnection[] {
  if (!target) return candidates;
  const match = candidates.find((c) => c.connectionId === target);
  if (!match) throw targetNotFound(target, "ratings@v1");
  return [match];
}

async function writeFeedbackLog(
  userId: string,
  input: EntFeedbackInput,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<void> {
  const signals = input.note ? extractSignals(input.note) : null;
  await getDb()
    .insert(feedback)
    .values({
      id: randomUUID(),
      userId,
      tmdbId,
      mediaType,
      action: input.action,
      rating: input.action === "rate" && typeof input.rating === "number" ? input.rating : null,
      note: typeof input.note === "string" && input.note.length > 0 ? input.note : null,
      extractedSignals: signals ? JSON.stringify(signals) : null,
      createdAt: Date.now(),
    });
}

async function loadMediaItemForRating(
  userId: string,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<Record<string, unknown>> {
  try {
    const details = await dispatchPrimary<Record<string, unknown>>({
      userId,
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: tmdbId, type: mediaType },
      mediaType,
    });
    if (details.data) return details.data;
  } catch (err) {
    consola.debug("[ent_feedback] metadata lookup failed", err);
  }
  // Minimal MediaItem shape accepted by ratings@v1.setRating. Plugins only use
  // `id`, `type`, and the id bundle to route the write.
  return {
    id: `${mediaType}:${tmdbId}`,
    title: "",
    year: null,
    type: mediaType,
    genres: [],
    rating: null,
    overview: "",
    posterUrl: null,
    ids: { tmdb_id: tmdbId },
  };
}

async function fanOutRating(
  userId: string,
  targets: EligibleConnection[],
  item: Record<string, unknown>,
  rating: number,
): Promise<{ synced: string[]; errors: FeedbackResponse["sync_errors"] }> {
  const results = await Promise.allSettled(
    targets.map((target) =>
      dispatchToConnection<{ ok: boolean }>({
        userId,
        connectionId: target.connectionId,
        capability: "ratings",
        version: "v1",
        method: "setRating",
        input: { item, rating },
      }),
    ),
  );
  const synced: string[] = [];
  const errors: FeedbackResponse["sync_errors"] = [];
  results.forEach((res, i) => {
    const target = targets[i]!;
    if (res.status === "fulfilled" && res.value?.ok !== false) {
      synced.push(target.connectionId);
    } else {
      const message =
        res.status === "rejected"
          ? res.reason instanceof Error
            ? res.reason.message
            : String(res.reason)
          : "plugin returned ok=false";
      errors.push({ connection_id: target.connectionId, message });
    }
  });
  return { synced, errors: errors.length ? errors : undefined };
}

export const entFeedbackHandler: ToolHandler = async (ctx, rawInput) => {
  const input = (rawInput ?? {}) as EntFeedbackInput;
  if (!input.id || !input.action) {
    throw badInput("ent_feedback", "id and action are required");
  }
  if (input.action !== "rate" && input.target) {
    throw badInput("ent_feedback", "target is only valid when action=rate");
  }
  if (input.action === "rate" && typeof input.rating !== "number") {
    throw badInput("ent_feedback", "rating is required when action=rate");
  }
  if (input.action === "note" && (typeof input.note !== "string" || input.note.length === 0)) {
    throw badInput("ent_feedback", "note is required when action=note");
  }

  const parsed = parseMediaId(input.id);
  await writeFeedbackLog(ctx.userId, input, parsed.tmdbId, parsed.type);

  const response: FeedbackResponse = { recorded: true, synced_to: [] };

  if (input.action === "rate") {
    const eligible = await listEligibleConnections(ctx.userId, "ratings", "v1");
    if (eligible.length > 0) {
      const targets = pickTargets(eligible, input.target);
      const item = await loadMediaItemForRating(ctx.userId, parsed.tmdbId, parsed.type);
      const fanout = await fanOutRating(ctx.userId, targets, item, input.rating!);
      response.synced_to = fanout.synced;
      if (fanout.errors) response.sync_errors = fanout.errors;
    }
  }

  return response;
};

export const entFeedbackRegistration: Omit<ToolRegistration, "source"> & { id: string } = {
  id: "ent_feedback",
  name: "ent_feedback",
  description:
    "Record your opinion on a movie or show. Supports likes, dislikes, ratings, and free-text notes that improve future recommendations.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "TMDB ID prefixed with type, e.g. 'movie:550'" },
      action: { type: "string", enum: ["like", "dislike", "rate", "note"] },
      rating: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Required when action=rate",
      },
      note: { type: "string", description: "Free-text feedback; required when action=note" },
      target: {
        type: "string",
        description:
          "Connection ID when you have multiple rating providers and action=rate. Omit to write to all.",
      },
    },
    required: ["id", "action"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    additionalProperties: true,
  },
  requiredScopes: ["mcp.write.feedback"],
  annotations: { destructiveHint: false, idempotentHint: false },
  handler: entFeedbackHandler,
};

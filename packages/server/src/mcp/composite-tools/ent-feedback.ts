import { consola } from "consola";
import {
  dispatchToConnection,
  listEligibleConnections,
  type EligibleConnection,
} from "../../media/connection-targeted";
import { dispatchPrimary } from "../../media/dispatcher";
import { getPreferenceEngine, feedbackLog } from "../../preferences";
import * as jobs from "../../jobs";
import { PREFERENCE_INCREMENTAL_JOB_ID } from "../../preferences/jobs";
import type { ToolHandler, ToolRegistration } from "../registry";
import { parseMediaId } from "../media-id";
import { badInput, targetNotFound } from "../errors";
import type { MediaItem } from "@ent-mcp/shared/media";

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
  profile_update?: string;
  sync_errors?: Array<{ connection_id: string; message: string }>;
}

interface MetadataPayload {
  id?: string;
  title?: string;
  year?: number | null;
  type?: "movie" | "tv";
  genres?: string[];
  keywords?: string[];
  cast?: string[];
  director?: string | null;
  runtime?: number | null;
  originalLanguage?: string | null;
  posterUrl?: string | null;
  rating?: number | null;
  overview?: string;
  ids?: { tmdb_id?: string };
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

async function loadMetadata(
  userId: string,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<MetadataPayload | null> {
  try {
    const details = await dispatchPrimary<MetadataPayload>({
      userId,
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: tmdbId, type: mediaType },
      mediaType,
    });
    return details.data ?? null;
  } catch (err) {
    consola.debug("[ent_feedback] metadata lookup failed", err);
    return null;
  }
}

function toMediaItemShape(
  metadata: MetadataPayload | null,
  tmdbId: string,
  mediaType: "movie" | "tv",
): MediaItem {
  return {
    id: `${mediaType}:${tmdbId}`,
    title: metadata?.title ?? "",
    year: typeof metadata?.year === "number" ? metadata.year : 0,
    type: mediaType,
    genres: metadata?.genres ?? [],
    rating: typeof metadata?.rating === "number" ? metadata.rating : null,
    overview: metadata?.overview ?? "",
    posterUrl: metadata?.posterUrl ?? null,
    status: "unknown",
    userRating: null,
    matchReason: null,
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

function triggerIncremental(userId: string): void {
  const entry = jobs.find(PREFERENCE_INCREMENTAL_JOB_ID);
  if (!entry || entry.kind !== "coalesced") return;
  const trigger = (
    entry as unknown as {
      trigger?: (input: { scopeKey: string } & Record<string, unknown>) => void;
    }
  ).trigger;
  if (typeof trigger === "function") trigger({ scopeKey: userId, userId });
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
  const metadata = await loadMetadata(ctx.userId, parsed.tmdbId, parsed.type);

  await feedbackLog.record({
    userId: ctx.userId,
    tmdbId: parsed.tmdbId,
    mediaType: parsed.type,
    action: input.action,
    rating: input.rating,
    note: input.note,
    itemKeywords: metadata?.keywords ?? [],
  });

  const mediaItem = toMediaItemShape(metadata, parsed.tmdbId, parsed.type);
  const engine = getPreferenceEngine();
  const profileUpdate = await engine.previewFeedbackEffect(ctx.userId, mediaItem, input.action, {
    rating: input.rating,
    note: input.note,
  });

  triggerIncremental(ctx.userId);

  const response: FeedbackResponse = { recorded: true, synced_to: [] };
  if (profileUpdate) response.profile_update = profileUpdate;

  if (input.action === "rate") {
    const eligible = await listEligibleConnections(ctx.userId, "ratings", "v1");
    if (eligible.length > 0) {
      const targets = pickTargets(eligible, input.target);
      const ratingPayload = {
        id: mediaItem.id,
        title: mediaItem.title,
        type: mediaItem.type,
        year: mediaItem.year,
        genres: mediaItem.genres,
        rating: mediaItem.rating,
        overview: mediaItem.overview,
        posterUrl: mediaItem.posterUrl,
        ids: { tmdb_id: parsed.tmdbId },
      };
      const fanout = await fanOutRating(ctx.userId, targets, ratingPayload, input.rating!);
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
    properties: {
      recorded: { type: "boolean" },
      synced_to: { type: "array", items: { type: "string" } },
      profile_update: { type: "string" },
      sync_errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            connection_id: { type: "string" },
            message: { type: "string" },
          },
          required: ["connection_id", "message"],
          additionalProperties: false,
        },
      },
    },
    required: ["recorded", "synced_to"],
    additionalProperties: false,
  },
  requiredScopes: ["mcp.write.feedback"],
  annotations: { destructiveHint: false, idempotentHint: false },
  handler: entFeedbackHandler,
};

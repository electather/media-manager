/**
 * `mediaRequest@v1` capability workflows backing the MediaService facade:
 * creating and cancelling download requests, listing request targets for the
 * picker, and the coalesced status-batch lookup.
 */
import {
  mediaRequestSchema,
  type CreateMediaRequestBody,
  type MediaRequest,
  type RequestTarget,
} from "@nama/shared/media";
import { z } from "zod";
import { HttpError, badRequest } from "../../diagnostics/http-errors";
import { mapRequestPluginError, PluginCallError } from "../errors";
import { decodeServiceId, encodeServiceId, TARGET_ID_RE } from "../internal/service-id";
import { dispatchToConnection, listEligibleConnections } from "./connection-targeted";
import { dispatchSingle } from "./dispatch";

interface ListTargetsOutput {
  targets: Array<{
    targetId: string;
    label: string;
    exposesProfiles: boolean;
    defaultProfileId: string | null;
    profiles: Array<{ id: string; label: string; detail?: string }>;
  }>;
}

interface CreateRequestOutput {
  success: boolean;
  requestId?: string;
  message?: string;
}

// fallow-ignore-next-line complexity
export async function requestDownload(
  userId: string,
  input: CreateMediaRequestBody,
): Promise<{ requestId: string | null }> {
  const decoded = decodeServiceId(input.serviceId);
  if (!decoded) throw badRequest("request.invalid_input", "malformed serviceId");
  const { connectionId, targetId } = decoded;

  if (input.mediaType === "movie" && input.seasons?.length) {
    console.warn("[mediaService] seasons ignored for movie request", {
      tmdbId: input.tmdbId,
    });
  }
  const seasonsCsv =
    input.mediaType === "tv" && input.seasons?.length ? input.seasons.join(",") : undefined;

  let result: CreateRequestOutput | null;
  try {
    result = await dispatchToConnection<CreateRequestOutput>({
      userId,
      connectionId,
      capability: "mediaRequest",
      version: "v1",
      method: "createRequest",
      input: {
        tmdbId: input.tmdbId,
        type: input.mediaType,
        seasons: seasonsCsv,
        targetId,
        ...(input.profileId ? { profileId: input.profileId } : {}),
      },
    });
  } catch (err) {
    const mapped = mapRequestPluginError(err);
    if (mapped) throw mapped;
    throw err;
  }

  if (!result || !result.success) {
    throw new HttpError(502, "request.provider_failed", result?.message ?? "provider failed");
  }
  return { requestId: result.requestId ?? null };
}

/**
 * Aggregates one entry per (user-connection × downstream target) for the
 * request picker. Per-connection failures are logged and skipped so a single
 * broken Seerr instance does not blank the whole picker; targets whose
 * `targetId` violates `TARGET_ID_RE` are dropped per-entry.
 */
// fallow-ignore-next-line complexity
export async function listRequestTargets(
  userId: string,
  mediaType: "movie" | "tv",
): Promise<RequestTarget[]> {
  const eligible = await listEligibleConnections(userId, "mediaRequest", "v1");
  // Fan out per connection in parallel — one slow Seerr instance otherwise
  // blocks the picker waiting on every other connection's response. Failures
  // are logged and skipped per-connection so a single broken instance does
  // not blank the whole picker.
  const settled = await Promise.allSettled(
    eligible.map((c) =>
      dispatchToConnection<ListTargetsOutput>({
        userId,
        connectionId: c.connectionId,
        capability: "mediaRequest",
        version: "v1",
        method: "listTargets",
        input: { type: mediaType },
      }),
    ),
  );

  const out: RequestTarget[] = [];
  for (const [i, settledResult] of settled.entries()) {
    const c = eligible[i]!;
    if (settledResult.status === "rejected") {
      const err = settledResult.reason as unknown;
      console.warn("[mediaService] listTargets failed", {
        pluginId: c.pluginId,
        connectionId: c.connectionId,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const result = settledResult.value;
    if (!result) continue;
    for (const t of result.targets) {
      if (!TARGET_ID_RE.test(t.targetId)) {
        console.warn("[mediaService] invalid targetId, skipping", {
          pluginId: c.pluginId,
          targetId: t.targetId,
        });
        continue;
      }
      out.push({
        serviceId: encodeServiceId(c.connectionId, t.targetId),
        pluginId: c.pluginId,
        label: t.label,
        exposesProfiles: t.exposesProfiles,
        defaultProfileId: t.defaultProfileId,
        profiles: t.profiles,
      });
    }
  }
  return out;
}

// fallow-ignore-next-line complexity
export async function getRequests(userId: string): Promise<MediaRequest[]> {
  try {
    const result = await dispatchSingle<unknown[]>({
      userId,
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    return z.array(mediaRequestSchema).parse(result ?? []);
  } catch (err) {
    // No provider configured — expected user state, not server fault.
    if (err instanceof PluginCallError && err.code === "media.no_connection") return [];
    throw err;
  }
}

// fallow-ignore-next-line complexity
export async function cancelRequest(userId: string, requestId: string): Promise<void> {
  let result: { ok: boolean; message?: string } | null;
  try {
    result = await dispatchSingle<{ ok: boolean; message?: string }>({
      userId,
      capability: "mediaRequest",
      version: "v1",
      method: "cancelRequest",
      input: { requestId },
    });
  } catch (err) {
    const mapped = mapRequestPluginError(err);
    if (mapped) throw mapped;
    throw err;
  }
  if (!result?.ok) {
    throw new HttpError(502, "request.provider_failed", result?.message ?? "provider failed");
  }
}

/**
 * Coalesced batch availability lookup. `mediaRequest@v1` is a `single`
 * strategy capability, so one plugin owns the response. Failures resolve
 * to an empty map — callers (today: the home feed dataloader) fall back to
 * `status: "unknown"` per item.
 */
// fallow-ignore-next-line complexity
export async function getStatusBatch(
  userId: string,
  ids: ReadonlyArray<string>,
  opts: { deadlineMs?: number } = {},
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const result = await dispatchSingle<{ statuses: Record<string, string> }>({
      userId,
      capability: "mediaRequest",
      version: "v1",
      method: "getStatusBatch",
      input: { ids: [...ids] },
      deadlineMs: opts.deadlineMs,
    });
    return result?.statuses ?? {};
  } catch (err) {
    if (err instanceof PluginCallError) return {};
    throw err;
  }
}

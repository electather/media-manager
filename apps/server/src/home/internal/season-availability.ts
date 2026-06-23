import type {
  SeasonAvailabilityError,
  SeasonAvailabilityResponse,
  SeasonAvailabilityServer,
} from "@nama/shared/home";
import type { HostErrorCode } from "@nama/shared/diagnostics";
import { capabilityRegistry } from "../../plugin-runtime";
import {
  resolveConnections,
  invokeOne,
  requireCapability,
  type ResolvedConnection,
} from "../../media";
import type { RowContext } from "./types";

/**
 * Stable server id for wire response; used by client to cache per-server collapsed/expanded state.
 * User connections use `${pluginId}:${connectionId}`; shared-credential pools use `pluginId`.
 */
function makeServerId(pluginId: string, conn: ResolvedConnection): string {
  return conn.kind === "user" ? `${pluginId}:${conn.connectionId}` : pluginId;
}

function makeServerLabel(pluginId: string): string {
  const entry = capabilityRegistry.get(pluginId);
  return entry?.module.manifest.name ?? pluginId;
}

/**
 * Aggregates per-server episode presence for a single show. Invokes each connection independently,
 * so failures appear in `errors[]` alongside surviving servers. Returns `{ servers: [] }` if no
 * provider configured — not an error; client renders "no connected servers" fallback.
 */
export async function composeSeasonAvailability(
  ctx: RowContext,
  tmdbId: string,
): Promise<SeasonAvailabilityResponse> {
  const providers = capabilityRegistry.listProviders("libraryAvailability", "v1", "user");
  if (providers.length === 0) return { servers: [] };
  const capability = requireCapability("libraryAvailability", "v1");

  const connectionsByPlugin = await Promise.all(
    providers.map(async (pluginId) => {
      // libraryAvailability@v1 is user-scoped: never borrow admin shared creds.
      const conns = await resolveConnections(ctx.userId, pluginId, "user");
      return conns.map((conn) => ({ pluginId, conn }));
    }),
  );
  const targets: Array<{ pluginId: string; conn: ResolvedConnection }> = connectionsByPlugin.flat();
  if (targets.length === 0) return { servers: [] };

  const settled = await Promise.all(
    targets.map(async ({ pluginId, conn }) => {
      const outcome = await invokeOne<{ episodes?: Array<{ season: number; episode: number }> }>(
        {
          userId: ctx.userId,
          pluginId,
          capability: "libraryAvailability",
          version: "v1",
          method: "listShowEpisodes",
          input: { id: tmdbId, idType: "tmdb" },
          timeoutMs: capability.defaultTimeoutMs,
        },
        conn,
      );
      return { pluginId, conn, outcome };
    }),
  );

  const servers: SeasonAvailabilityServer[] = [];
  const errors: SeasonAvailabilityError[] = [];
  for (const { pluginId, conn, outcome } of settled) {
    const serverId = makeServerId(pluginId, conn);
    const serverLabel = makeServerLabel(pluginId);
    if (outcome.error) {
      errors.push({
        serverId,
        serverLabel,
        code: outcome.error.code as HostErrorCode,
      });
      continue;
    }
    const episodes = outcome.data?.episodes ?? [];
    const sorted = [...episodes].sort((a, b) =>
      a.season === b.season ? a.episode - b.episode : a.season - b.season,
    );
    servers.push({ serverId, serverLabel, episodesPresent: sorted });
  }

  const response: SeasonAvailabilityResponse = { servers };
  if (errors.length > 0) response.errors = errors;
  return response;
}

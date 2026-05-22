import { eq } from "drizzle-orm";
import type { PrimaryConnectionRow } from "@ent-mcp/shared/connections";
import type { MediaType } from "@ent-mcp/shared/media";
import { getDb } from "../db/client";
// fallow-allow: connections owns primary-connection writes; the underlying
// table + service still live under media until the preferences module lands.
// fallow-ignore-next-line boundary-violation
import { primaryConnections } from "../db/schema/preferences/user-preferences";
// fallow-allow: invalidate the dispatcher cache so a picker change takes
// effect on the next request rather than waiting out the TTL.
// fallow-ignore-next-line boundary-violation
import { clearPrimaryConnection, invalidateUserCache, setPrimaryConnection } from "../media";
// fallow-allow: capability advertisement lives in the in-memory plugin
// registry; the wrapper here gates writes to plugins that actually expose
// the requested capability at user scope.
// fallow-ignore-next-line boundary-violation
import { capabilityRegistry } from "../plugin-runtime";
import { unprocessable } from "../diagnostics/http-errors";
import { requireConnection } from "./helpers";

const NO_MEDIA_TYPE_SENTINEL = "_";

function normalizeMediaType(mediaType: MediaType | null): string {
  return mediaType ?? NO_MEDIA_TYPE_SENTINEL;
}

function denormalizeMediaType(mediaType: string): MediaType | null {
  return mediaType === NO_MEDIA_TYPE_SENTINEL ? null : (mediaType as MediaType);
}

/**
 * Resolves the connection row owned by `userId` and asserts the connection's
 * plugin advertises `capabilityKey` at user scope. Returns the resolved
 * pluginId for diagnostic context. Throws `notFound("connection.not_found")`
 * when the row is missing / foreign and `unprocessable(
 * "connection.capability_unsupported")` when the manifest doesn't declare the
 * capability.
 */
async function assertOwnedAndSupportsCapability(args: {
  userId: string;
  connectionId: string;
  capabilityKey: string;
}): Promise<string> {
  const row = await requireConnection(getDb(), args.connectionId, args.userId);
  const [capId, capVersion] = args.capabilityKey.split("@");
  const entry = capId ? capabilityRegistry.get(row.pluginId) : undefined;
  const cap = entry && capId ? entry.module.manifest.capabilities[capId] : undefined;
  if (!cap || cap.version !== capVersion || cap.scope !== "user") {
    throw unprocessable(
      "connection.capability_unsupported",
      `plugin does not advertise ${args.capabilityKey} at user scope`,
      { pluginId: row.pluginId, capabilityKey: args.capabilityKey },
    );
  }
  return row.pluginId;
}

export const primaryConnectionsService = {
  async listForUser(userId: string): Promise<PrimaryConnectionRow[]> {
    const db = getDb();
    const rows = await db
      .select({
        capabilityKey: primaryConnections.capabilityKey,
        mediaType: primaryConnections.mediaType,
        connectionId: primaryConnections.connectionId,
      })
      .from(primaryConnections)
      .where(eq(primaryConnections.userId, userId))
      .all();
    return rows.map((row) => ({
      capabilityKey: row.capabilityKey,
      mediaType: denormalizeMediaType(row.mediaType),
      connectionId: row.connectionId,
    }));
  },

  async set(args: {
    userId: string;
    capabilityKey: string;
    mediaType: MediaType | null;
    connectionId: string;
  }): Promise<void> {
    await assertOwnedAndSupportsCapability({
      userId: args.userId,
      connectionId: args.connectionId,
      capabilityKey: args.capabilityKey,
    });
    await setPrimaryConnection({
      userId: args.userId,
      capabilityKey: args.capabilityKey,
      mediaType: normalizeMediaType(args.mediaType),
      connectionId: args.connectionId,
    });
    await invalidateUserCache(args.userId);
  },

  async clear(args: {
    userId: string;
    capabilityKey: string;
    mediaType: MediaType | null;
  }): Promise<void> {
    await clearPrimaryConnection({
      userId: args.userId,
      capabilityKey: args.capabilityKey,
      mediaType: normalizeMediaType(args.mediaType),
    });
    await invalidateUserCache(args.userId);
  },
};

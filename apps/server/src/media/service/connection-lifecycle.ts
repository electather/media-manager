import { consola } from "consola";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { serviceConnections } from "../../db/schema";
import { encryptJson } from "../../crypto/helpers";
import { emit } from "../../jobs/events";
import { MEDIA_EVENTS, connectionAuthExpiredPayload } from "../events";

export async function emitAuthExpired(args: {
  connectionId: string;
  pluginId: string;
  userId: string;
}): Promise<void> {
  try {
    await emit(MEDIA_EVENTS.CONNECTION_AUTH_EXPIRED, connectionAuthExpiredPayload, args);
  } catch (err) {
    consola.error("[dispatcher] auth-expired notification emit failed:", err);
  }
}

export async function persistRefreshedCredentials(
  connectionId: string,
  credentials: unknown,
): Promise<void> {
  const { iv, data } = await encryptJson(credentials);
  await getDb()
    .update(serviceConnections)
    .set({
      encryptedCredentials: data,
      credentialsIv: iv,
      status: "connected",
      errorMessage: null,
      lastVerifiedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(serviceConnections.id, connectionId));
}

export async function markConnectionStatus(
  connectionId: string | null,
  status: "expired" | "error",
  message: string,
): Promise<void> {
  if (!connectionId) return;
  await getDb()
    .update(serviceConnections)
    .set({ status, errorMessage: message, updatedAt: Date.now() })
    .where(eq(serviceConnections.id, connectionId));
}

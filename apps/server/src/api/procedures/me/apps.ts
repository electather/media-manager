import { and, eq, sql } from "drizzle-orm";
import { compact } from "es-toolkit/array";
import type { AuthorizedApp, AuthorizedAppStatus } from "@nama/shared/users";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "../../../db/schema/auth";
import type { Db } from "../../../db/client";
import { notFound } from "../../../diagnostics/http-errors";

type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

interface AppRow {
  clientId: string;
  name: string | null;
  scopes: unknown;
  connectedAt: number | Date | null;
  ownerUserId: string | null;
  lastUsedAt: number | Date | null;
}

export async function listAuthorizedApps(db: DbOrTx, userId: string): Promise<AuthorizedApp[]> {
  const rows = (await db
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      scopes: oauthConsent.scopes,
      // `MIN()` so the column is aggregated under `GROUP BY oauthConsent.clientId`
      // — same value either way (one consent per (user, client) pair) but lets
      // strict-mode SQL backends accept the projection.
      connectedAt: sql<number | null>`MIN(${oauthConsent.createdAt})`,
      ownerUserId: oauthClient.userId,
      lastUsedAt: sql<number | null>`MAX(${oauthAccessToken.createdAt})`,
    })
    .from(oauthConsent)
    .leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .leftJoin(
      oauthAccessToken,
      and(
        eq(oauthAccessToken.clientId, oauthConsent.clientId),
        eq(oauthAccessToken.userId, userId),
      ),
    )
    .where(eq(oauthConsent.userId, userId))
    .groupBy(oauthConsent.clientId, oauthClient.name, oauthClient.userId)) as AppRow[];

  const now = Date.now();
  return rows.map((row) => toAuthorizedApp(row, userId, now));
}

function toAuthorizedApp(row: AppRow, userId: string, now: number): AuthorizedApp {
  const connectedAt = toEpochMillis(row.connectedAt) ?? 0;
  const lastUsedAt = toEpochMillis(row.lastUsedAt);
  return {
    clientId: row.clientId,
    name: row.name?.trim() || row.clientId,
    scopes: parseScopes(row.scopes),
    connectedAt,
    lastUsedAt,
    ownedByUser: row.ownerUserId === userId,
    status: deriveStatus({ now, connectedAt, lastUsedAt }),
  };
}

function deriveStatus(args: {
  now: number;
  connectedAt: number;
  lastUsedAt: number | null;
}): AuthorizedAppStatus {
  const { now, connectedAt, lastUsedAt } = args;
  if (isActiveUse(now, lastUsedAt)) return "active";
  if (isRecentConnection(now, connectedAt, lastUsedAt)) return "new";
  return "idle";
}

function isActiveUse(now: number, lastUsedAt: number | null): boolean {
  return lastUsedAt !== null && now - lastUsedAt <= ACTIVE_WINDOW_MS;
}

function isRecentConnection(now: number, connectedAt: number, lastUsedAt: number | null): boolean {
  return lastUsedAt === null && connectedAt > 0 && now - connectedAt <= NEW_WINDOW_MS;
}

// fallow-ignore-next-line complexity
function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return compact(raw.split(/[\s,]+/));
  }
}

function toEpochMillis(value: number | Date | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

export interface RevokeResult {
  apps: AuthorizedApp[];
}

/**
 * Revokes the user's authorization for one OAuth client. In a single
 * transaction: deletes access tokens, refresh tokens, and the consent row
 * for `(user, client)`. If the user owns the client AND no other consent
 * rows reference it, the client row is also deleted.
 */
export async function revokeAuthorizedApp(
  db: Db,
  userId: string,
  clientId: string,
): Promise<RevokeResult> {
  await db.transaction(async (tx) => {
    const consent = await tx
      .select({ id: oauthConsent.id })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .get();

    if (!consent) {
      throw notFound("me.app_not_authorized", "no consent for this client", { clientId });
    }

    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));

    await tx
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)));

    await tx.delete(oauthConsent).where(eq(oauthConsent.id, consent.id));

    await deleteOwnedOrphanClient(tx, userId, clientId);
  });

  return { apps: await listAuthorizedApps(db, userId) };
}

async function deleteOwnedOrphanClient(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  userId: string,
  clientId: string,
): Promise<void> {
  const client = await tx
    .select({ userId: oauthClient.userId })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .get();

  if (!client || client.userId !== userId) return;

  const stillReferenced = await tx
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(eq(oauthConsent.clientId, clientId))
    .get();

  if (stillReferenced) return;

  await tx.delete(oauthClient).where(eq(oauthClient.clientId, clientId));
}

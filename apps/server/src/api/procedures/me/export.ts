import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { session, user } from "../../../db/schema/auth";
import { feedback } from "../../../db/schema/feedback";
import { jobRuns } from "../../../db/schema/jobs";
import { preferenceProfiles } from "../../../db/schema/preferences";
import { primaryConnections } from "../../../db/schema/user-preferences";
import { serviceConnections } from "../../../db/schema/credentials";
import type { Db } from "../../../db/client";
import { fetchUserRole } from "./queries";
import { notFound } from "../../../errors/http-errors";
import { listAuthorizedApps } from "./apps";

export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportArtifact {
  zipBytes: ArrayBuffer;
  filename: string;
}

/**
 * Builds the user's data-export ZIP. All reads happen inside a single
 * transaction so the snapshot is point-in-time consistent. The ZIP body
 * is buffered into an ArrayBuffer (Workers-compatible) — self-hosted users'
 * data is small enough that streaming is not worth the complexity for v1.
 */
export async function buildUserExport(db: Db, userId: string): Promise<ExportArtifact> {
  const snapshot = await readUserSnapshot(db, userId);
  const zip = packIntoZip(snapshot);
  const zipBytes = await zip.generateAsync({ type: "arraybuffer" });
  return { zipBytes, filename: filenameFor(userId) };
}

interface UserSnapshot {
  identity: Record<string, unknown>;
  role: { name: string; description: string | null } | null;
  sessions: Array<Record<string, unknown>>;
  oauthApps: unknown[];
  connections: Array<Record<string, unknown>>;
  primaryConnections: Array<Record<string, unknown>>;
  preferenceProfiles: Array<Record<string, unknown>>;
  feedback: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
}

async function readUserSnapshot(db: Db, userId: string): Promise<UserSnapshot> {
  return db.transaction(async (tx) => {
    const identityRow = await tx
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .get();

    if (!identityRow) {
      throw notFound("me.export.user_not_found", "user not found", { userId });
    }

    const roleRow = await fetchUserRole(tx as unknown as Db, userId);

    const sessions = await tx
      .select({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(eq(session.userId, userId))
      .all();

    const connections = await tx
      .select({
        id: serviceConnections.id,
        pluginId: serviceConnections.pluginId,
        displayName: serviceConnections.displayName,
        status: serviceConnections.status,
        enabled: serviceConnections.enabled,
        isDefault: serviceConnections.isDefault,
        createdAt: serviceConnections.createdAt,
        updatedAt: serviceConnections.updatedAt,
      })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId))
      .all();

    const primaries = await tx
      .select()
      .from(primaryConnections)
      .where(eq(primaryConnections.userId, userId))
      .all();

    const profiles = await tx
      .select()
      .from(preferenceProfiles)
      .where(eq(preferenceProfiles.userId, userId))
      .all();

    const feedbackRows = await tx.select().from(feedback).where(eq(feedback.userId, userId)).all();

    const jobs = await tx.select().from(jobRuns).where(eq(jobRuns.triggeredByUserId, userId)).all();

    const oauthApps = await listAuthorizedApps(tx, userId);

    return {
      identity: serializeRow(identityRow),
      role: roleRow ? { name: roleRow.name, description: roleRow.description } : null,
      sessions: sessions.map(serializeRow),
      oauthApps,
      connections: connections.map(serializeRow),
      primaryConnections: primaries.map(serializeRow),
      preferenceProfiles: profiles.map(serializeRow),
      feedback: feedbackRows.map(serializeRow),
      jobs: jobs.map(serializeRow),
    };
  });
}

function packIntoZip(snapshot: UserSnapshot): JSZip {
  const zip = new JSZip();
  zip.file("identity.json", asJson(snapshot.identity));
  zip.file("role.json", asJson(snapshot.role));
  zip.file("sessions.json", asJson(snapshot.sessions));
  zip.file("oauth-apps.json", asJson(snapshot.oauthApps));
  zip.file("connections.json", asJson(snapshot.connections));
  zip.file("primary-connections.json", asJson(snapshot.primaryConnections));
  const taste = zip.folder("taste");
  taste?.file("preference-profiles.json", asJson(snapshot.preferenceProfiles));
  taste?.file("feedback.json", asJson(snapshot.feedback));
  zip.file("jobs.json", asJson(snapshot.jobs));
  zip.file("README.txt", buildReadme());
  return zip;
}

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function filenameFor(userId: string): string {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `ent-mcp-export-${userId}-${today}.zip`;
}

function buildReadme(): string {
  return [
    `ent-mcp data export`,
    ``,
    `schema-version: ${EXPORT_SCHEMA_VERSION}`,
    `exported-at: ${new Date().toISOString()}`,
    ``,
    `Files`,
    `-----`,
    `identity.json             Your user row.`,
    `role.json                 Your assigned role (or null).`,
    `sessions.json             Active session metadata.`,
    `oauth-apps.json           Authorized MCP applications. No tokens or secrets.`,
    `connections.json          Service connections. NO credentials.`,
    `primary-connections.json  Per-capability primary-connection picks.`,
    `taste/preference-profiles.json   Per-media-type preference profiles.`,
    `taste/feedback.json       Likes, dislikes, ratings, notes.`,
    `jobs.json                 Job runs you triggered (history, anonymized on delete).`,
    ``,
    `Future exports may add or change fields. The schema-version above lets`,
    `consumers detect compatible shapes.`,
  ].join("\n");
}

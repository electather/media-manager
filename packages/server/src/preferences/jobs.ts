import { consola } from "consola";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { feedback, preferenceProfiles } from "../db/schema";
import { registerCoalesced } from "../jobs/coalesced";
import { registerScheduledPerRow } from "../jobs/scheduled-per-row";
import { registerTriggerable } from "../jobs/triggerable";
import { getPreferenceEngine } from "./index";

export const PREFERENCE_DAILY_JOB_ID = "host.preference.daily_rebuild";
export const PREFERENCE_INCREMENTAL_JOB_ID = "host.preference.incremental_update";
export const PREFERENCE_MANUAL_REBUILD_JOB_ID = "feature.preference.rebuild";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const INCREMENTAL_REBUILD_THRESHOLD = 20;

export interface RebuildRow {
  userId: string;
}

/**
 * Registers the three jobs the preference engine owns. Called once at host
 * startup alongside other scheduler registrations.
 */
export function registerPreferenceJobs(): void {
  registerScheduledPerRow<RebuildRow>({
    id: PREFERENCE_DAILY_JOB_ID,
    schedule: "0 2 * * *",
    rowSource: listUsersNeedingRebuild,
    handler: async (ctx, row) => {
      const engine = getPreferenceEngine();
      await engine.rebuildProfile(row.userId, "movie", ctx.abortSignal);
      await engine.rebuildProfile(row.userId, "tv", ctx.abortSignal);
      await engine.rebuildProfile(row.userId, "combined", ctx.abortSignal);
    },
    perRowTimeoutSec: 120,
    runTimeoutSec: 60 * 60,
    continueOnRowError: true,
  });

  registerCoalesced({
    id: PREFERENCE_INCREMENTAL_JOB_ID,
    debounceMs: 30_000,
    maxWaitMs: 5 * 60_000,
    scopeKey: (input) => String((input as { userId?: string }).userId ?? ""),
    handler: async (_ctx, _triggerCount, scopeKey) => {
      if (!scopeKey) return;
      await getPreferenceEngine().applyIncrementalUpdate(scopeKey);
    },
    timeoutSec: 60,
  });

  registerTriggerable<{ userId: string }, { rebuiltAt: number }>({
    id: PREFERENCE_MANUAL_REBUILD_JOB_ID,
    handler: async (ctx, input) => {
      if (!input?.userId) throw new Error("userId is required");
      const engine = getPreferenceEngine();
      await engine.rebuildProfile(input.userId, "movie", ctx.abortSignal);
      await engine.rebuildProfile(input.userId, "tv", ctx.abortSignal);
      await engine.rebuildProfile(input.userId, "combined", ctx.abortSignal);
      return { rebuiltAt: Date.now() };
    },
    scopeKey: (input) => input.userId,
    requiredPermission: {
      kind: "feature",
      check: async (userId, input) => {
        const typed = input as { userId?: string } | null;
        return typeof typed?.userId === "string" && typed.userId === userId;
      },
    },
    inputSchema: {
      type: "object",
      properties: { userId: { type: "string" } },
      required: ["userId"],
      additionalProperties: false,
    },
    timeoutSec: 600,
  });

  consola.debug("[preference] registered daily, incremental, and manual-rebuild jobs");
}

/**
 * Drives the daily rebuild row source. Unions three conditions: first-run
 * users (any activity, no profile), stale-profile users, and users whose
 * incremental buffer has accumulated enough signal to warrant a full rebuild.
 */
export async function listUsersNeedingRebuild(now: number = Date.now()): Promise<RebuildRow[]> {
  const db = getDb();

  const firstRun = await db
    .selectDistinct({ userId: feedback.userId })
    .from(feedback)
    .leftJoin(preferenceProfiles, eq(preferenceProfiles.userId, feedback.userId))
    .where(sql`${preferenceProfiles.userId} IS NULL`)
    .all();

  const stale = await db
    .selectDistinct({ userId: preferenceProfiles.userId })
    .from(preferenceProfiles)
    .where(sql`${preferenceProfiles.lastRebuiltAt} < ${now - SEVEN_DAYS_MS}`)
    .all();

  const bursty = await db
    .select({ userId: feedback.userId })
    .from(feedback)
    .innerJoin(preferenceProfiles, eq(preferenceProfiles.userId, feedback.userId))
    .where(and(gt(feedback.createdAt, preferenceProfiles.lastRebuiltAt)))
    .groupBy(feedback.userId)
    .having(sql`count(${feedback.id}) >= ${INCREMENTAL_REBUILD_THRESHOLD}`)
    .all();

  const ids = new Set<string>();
  for (const row of [...firstRun, ...stale, ...bursty]) {
    ids.add(row.userId);
  }
  return [...ids].map((userId) => ({ userId }));
}

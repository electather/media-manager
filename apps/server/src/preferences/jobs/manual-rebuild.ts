import { type ProfileMediaType, type RebuildResult } from "@ent-mcp/shared/preferences";

import { getCatalogService, writeRecommendationsForUser } from "../../catalog";
import { registerTriggerable } from "../../jobs/triggerable";
import {
  readRecListSummary,
  rebuildPartitions,
  summarisePartitions,
} from "../internal/manual-rebuild-helpers";

export const PREFERENCE_MANUAL_REBUILD_JOB_ID = "feature.preference.rebuild";

/**
 * Triggerable on-demand rebuild. Used by the user-facing settings page
 * (`POST /api/preferences/rebuild`) and by admins. Runs the three partition
 * rebuilds + writes a fresh recommendation list so the result is visible
 * immediately rather than waiting for the next 02:00 sweep.
 */
export function registerManualRebuild(): void {
  registerTriggerable<
    { userId: string },
    {
      startedAt: string;
      rebuiltAt: string;
      durationMs: number;
      results: Partial<Record<ProfileMediaType, RebuildResult>>;
      warnings: string[];
    }
  >({
    id: PREFERENCE_MANUAL_REBUILD_JOB_ID,
    name: "Rebuild preference profile",
    description: "Full rebuild of a user's preference profile on demand.",
    // fallow-ignore-next-line complexity
    handler: async (ctx, input) => {
      if (!input?.userId) {
        ctx.logger.warn("Aborted: userId is required in input");
        throw new Error("userId is required");
      }

      const startTime = performance.now();
      const startedAt = new Date().toISOString();
      const userId = input.userId;

      ctx.logger.info(`Starting manual rebuild`, {
        jobId: PREFERENCE_MANUAL_REBUILD_JOB_ID,
        userId,
        timestamp: startedAt,
      });

      try {
        const { results, warnings, traces } = await rebuildPartitions(userId, ctx);

        // Mirror the nightly catalog rec build so the manual trigger surfaces
        // a fresh recommendation list immediately rather than waiting for the
        // next 02:00 sweep. The per-partition rebuild above already bumped
        // `profile_version`; `writeRecommendationsForUser` skips the rebuild
        // step and only writes the rec list against the freshly-versioned
        // profile.
        const catalog = getCatalogService();
        const recStart = performance.now();
        let recWriteFailed = false;
        try {
          await writeRecommendationsForUser({ catalog }, userId, ctx.abortSignal, (msg) =>
            ctx.logger.debug(msg),
          );
        } catch (recErr) {
          recWriteFailed = true;
          warnings.push(
            `Recommendation list write failed: ${recErr instanceof Error ? recErr.message : String(recErr)}`,
          );
        }
        const recWriteDurationMs = Math.round(performance.now() - recStart);

        // Read the persisted rec list back so the end-of-run summary can
        // report what was actually written. Diagnostic-only — a read failure
        // here must not fail the job, since the rebuild itself succeeded.
        const recSummary = await readRecListSummary(catalog, userId).catch(() => null);

        const durationMs = Math.round(performance.now() - startTime);
        const partitionSummary = summarisePartitions(results, traces);

        const endLog = {
          userId,
          durationMs,
          partitions: partitionSummary,
          recList: {
            written: !recWriteFailed,
            durationMs: recWriteDurationMs,
            itemCount: recSummary?.itemCount ?? null,
            profileVersion: recSummary?.profileVersion ?? null,
            generatedAt: recSummary?.generatedAt ?? null,
          },
          warningCount: warnings.length,
          warnings,
          results,
        };

        if (warnings.length > 0) {
          ctx.logger.warn(`Completed with warnings for user ${userId}`, endLog);
        } else {
          ctx.logger.success(`Completed successfully for user ${userId}`, endLog);
        }

        return { startedAt, rebuiltAt: new Date().toISOString(), durationMs, results, warnings };
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);
        ctx.logger.error(`Failed for user ${userId}`, {
          userId,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
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
      properties: { userId: { type: "string", "x-picker": "user" } },
      required: ["userId"],
      additionalProperties: false,
    },
    timeoutSec: 600,
  });
}

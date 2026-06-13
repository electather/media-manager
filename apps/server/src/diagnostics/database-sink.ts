import type { ErrorRecord, PerfRecord } from "@nama/shared/diagnostics";
import { SYSTEM_USER_ID } from "@nama/shared/jobs";
import { getDb } from "../db/client";
import { errorRecords, perfRecords } from "../db/schema/infra/diagnostics";
import type { DiagnosticSink } from "./types";

// __system__ has no user-table row, so FK constraints reject it.
// Normalise to null before any DB insert.
function toUserFkValue(userId: string | null | undefined): string | null {
  return userId === SYSTEM_USER_ID ? null : (userId ?? null);
}

/** Built-in sink that persists both error and perf records to SQLite. */
export class DatabaseSink implements DiagnosticSink {
  async captureError(record: ErrorRecord): Promise<void> {
    const db = getDb();
    await db.insert(errorRecords).values({
      id: record.id,
      requestId: record.requestId,
      severity: record.severity,
      source: record.source,
      code: record.code,
      devMessage: record.devMessage,
      stack: record.stack,
      resolvedStack: record.resolvedStack,
      userId: toUserFkValue(record.userId),
      pluginId: record.pluginId,
      connectionId: record.connectionId,
      route: record.route,
      httpStatus: record.httpStatus,
      context: record.context,
      createdAt: record.createdAt,
    });
  }

  async capturePerf(record: PerfRecord): Promise<void> {
    const db = getDb();
    await db.insert(perfRecords).values({
      id: record.id,
      requestId: record.requestId,
      kind: record.kind,
      durationMs: record.durationMs,
      route: record.route,
      method: record.method,
      status: record.status,
      pluginId: record.pluginId,
      userId: toUserFkValue(record.userId),
      createdAt: record.createdAt,
    });
  }
}

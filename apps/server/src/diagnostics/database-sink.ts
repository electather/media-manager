import type { ErrorRecord, PerfRecord } from "@ent-mcp/shared/diagnostics";
import { getDb } from "../db/client";
import { errorRecords, perfRecords } from "../db/schema/diagnostics";
import type { DiagnosticSink } from "./types";

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
      userId: record.userId,
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
      userId: record.userId,
      createdAt: record.createdAt,
    });
  }
}

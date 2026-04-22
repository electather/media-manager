import type { ErrorRecord } from "@ent-mcp/shared/errors";
import { getDb } from "../db/client";
import { errorRecords } from "../db/schema/errors";
import type { ErrorSink } from "./types";

/** Built-in sink that persists records to the `error_records` table. */
export class DatabaseSink implements ErrorSink {
  async capture(record: ErrorRecord): Promise<void> {
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
}

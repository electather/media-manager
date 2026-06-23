import type { z } from "zod";
import { findEntry } from "./registry";
import { newRequestId } from "../diagnostics/request-context";
import type { EventName } from "./event-name";

/**
 * Schedules immediate event dispatcher run; throws if no consumer registered (wiring bug in `registerJobs`).
 * Isolated to avoid `events → triggerable → runner → events` circular-deps cycle.
 */
async function enqueue(name: string, payload: unknown): Promise<void> {
  const entry = findEntry(name);
  if (!entry?.triggerFromApi) {
    throw new Error(`event "${name}" has no registered handler`);
  }
  await entry.triggerFromApi(payload, {
    triggeredBy: "cron",
    requestId: newRequestId(),
  });
}

/**
 * Publishes an event. Payload is validated synchronously via `schema` so a
 * failure fails the calling sync operation (and rolls back any open
 * transaction) before anything lands in the queue.
 */
export async function emit<P>(name: EventName, schema: z.ZodType<P>, payload: P): Promise<void> {
  const validated = schema.parse(payload);
  await enqueue(name as string, validated);
}

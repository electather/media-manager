import type { CapabilityDefinition } from "@ent-mcp/plugin-sdk";
import type { InvocationOutcome } from "../errors";
import type { ResolvedConnection } from "../resolve-connection";
import type { DispatchRequest, AggregateResult } from "../types";
import { invokeOne } from "../invoke";

export interface Candidate {
  pluginId: string;
  conn: ResolvedConnection;
}

export async function invokeAll<T>(
  candidates: Candidate[],
  req: DispatchRequest,
  capability: CapabilityDefinition,
): Promise<InvocationOutcome<T>[]> {
  return Promise.all(
    candidates.map(({ pluginId, conn }) =>
      invokeOne<T>(
        {
          userId: req.userId,
          pluginId,
          capability: req.capability,
          version: req.version,
          method: req.method,
          input: req.input,
          timeoutMs: capability.defaultTimeoutMs,
          deadlineMs: req.deadlineMs,
        },
        conn,
      ),
    ),
  );
}

export function collectErrors<T>(outcomes: InvocationOutcome<T>[]): AggregateResult<T>["errors"] {
  const errors: AggregateResult<T>["errors"] = [];
  for (const outcome of outcomes) {
    if (outcome.error && outcome.error.code !== "plugin.item_not_found") {
      errors.push({
        pluginId: outcome.pluginId,
        connectionId: outcome.connectionId,
        code: outcome.error.code,
        devMessage: outcome.error.devMessage,
      });
    }
  }
  return errors;
}

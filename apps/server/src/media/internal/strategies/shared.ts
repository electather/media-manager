import type { CapabilityDefinition } from "@ent-mcp/plugin-sdk";
import { capabilityRegistry } from "../../../plugin-runtime";
import { requireCapability, scopeForRequest } from "../capability-lookup";
import { readCache } from "../dispatch-cache";
import type { InvocationOutcome } from "../../errors";
import type { ResolvedConnection } from "../resolve-connection";
import type { DispatchRequest, AggregateResult } from "../../types";
import { invokeOne } from "../../service/invoke";

export function resolveCapabilityScope(req: DispatchRequest) {
  const capability = requireCapability(req.capability, req.version);
  const scope = scopeForRequest(capability, req.input);
  return { capability, scope };
}

/**
 * Resolves the capability/scope, reads the cache, and lists registered
 * providers. Callers check `cached !== undefined` for an early return and
 * `providers.length === 0` for a no-provider guard; both checks are
 * intentionally left to the caller so each strategy can apply its own
 * semantics (return vs throw).
 */
export async function resolveDispatchPreamble<T>(req: DispatchRequest) {
  const { capability, scope } = resolveCapabilityScope(req);
  const cached = await readCache<T>(req, scope);
  const providers = capabilityRegistry.listProviders(req.capability, req.version, scope);
  return { capability, scope, cached, providers };
}

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

import type { JobKind } from "@ent-mcp/shared/jobs";
import type { AdminOrFeaturePermission, TriggerSource } from "./types";

/**
 * An entry is the internal, runtime-owned view of a registered job. The public
 * JobHandle surface is derived from this. Each entry carries the kind-specific
 * trigger/cancel behavior so consumers of the registry do not need to switch
 * on kind when dispatching.
 */
export interface RegistryEntry {
  id: string;
  name: string;
  description?: string;
  kind: JobKind;
  schedule?: string;
  capture?: { source?: "cron" | "plugin"; pluginId?: string };
  inputSchema?: Record<string, unknown>;

  requiredPermission?: AdminOrFeaturePermission;

  dispose(): void;
  triggerFromApi?: (
    input: unknown,
    source: TriggerSource,
  ) => Promise<{ runId: string; result: unknown }>;
  cancel?: (scopeKey?: string) => boolean;
  onScheduleChange?: (schedule: string) => void;
  onEnabledChange?: (enabled: boolean) => void;
}

const entries = new Map<string, RegistryEntry>();

export function register(entry: RegistryEntry): void {
  if (entries.has(entry.id)) {
    throw new Error(`duplicate job id: ${entry.id}`);
  }
  entries.set(entry.id, entry);
}

export function unregister(jobId: string): void {
  const entry = entries.get(jobId);
  if (!entry) return;
  entry.dispose();
  entries.delete(jobId);
}

export function find(jobId: string): RegistryEntry | undefined {
  return entries.get(jobId);
}

export function list(): RegistryEntry[] {
  return Array.from(entries.values());
}

export function clear(): void {
  for (const entry of entries.values()) entry.dispose();
  entries.clear();
}

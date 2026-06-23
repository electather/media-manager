import type { JobKind } from "@nama/shared/jobs";
import type { AdminOrFeaturePermission, TriggerSource } from "./types";

/** Runtime view of a registered job. Public JobHandle is derived from this. Carries kind-specific trigger/cancel behavior. */
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

export function unregisterEntry(jobId: string): void {
  const entry = entries.get(jobId);
  if (!entry) return;
  entry.dispose();
  entries.delete(jobId);
}

export function findEntry(jobId: string): RegistryEntry | undefined {
  return entries.get(jobId);
}

export function listEntries(): RegistryEntry[] {
  return Array.from(entries.values());
}

export function clear(): void {
  for (const entry of entries.values()) entry.dispose();
  entries.clear();
}

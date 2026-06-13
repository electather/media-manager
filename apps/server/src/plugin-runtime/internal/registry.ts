import type { CapabilityScope } from "@nama/shared/plugins";
import { capabilityKey } from "@nama/plugin-sdk";
import type { PluginModule } from "@nama/plugin-sdk";

export interface RegistryEntry {
  pluginId: string;
  module: PluginModule;
  enabled: boolean;
}

/** Composite index key: "capabilityId@version|scope". */
function scopedKey(capability: string, version: string, scope: CapabilityScope): string {
  return `${capabilityKey(capability, version)}|${scope}`;
}

/**
 * In-memory registry indexed by (capabilityId, version, scope). Global and
 * user-scoped lookups are independent — "who provides metadata@v1 globally?"
 * and "who provides watchlist@v1 for a user?" are separate queries.
 */
export class CapabilityRegistry {
  private byScopedCapability = new Map<string, Set<string>>();
  private byPlugin = new Map<string, RegistryEntry>();

  register(entry: RegistryEntry): void {
    this.byPlugin.set(entry.pluginId, entry);
    if (!entry.enabled) return;
    for (const [capId, cap] of Object.entries(entry.module.manifest.capabilities)) {
      const key = scopedKey(capId, cap.version, cap.scope);
      if (!this.byScopedCapability.has(key)) this.byScopedCapability.set(key, new Set());
      this.byScopedCapability.get(key)!.add(entry.pluginId);
    }
  }

  unregister(pluginId: string): void {
    this.byPlugin.delete(pluginId);
    for (const set of this.byScopedCapability.values()) set.delete(pluginId);
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const entry = this.byPlugin.get(pluginId);
    if (!entry) return;
    entry.enabled = enabled;
    this.unregister(pluginId);
    this.byPlugin.set(pluginId, entry);
    if (enabled) this.register(entry);
  }

  /** Providers of a capability at the given (version, scope). */
  listProviders(capability: string, version: string, scope: CapabilityScope): string[] {
    return [...(this.byScopedCapability.get(scopedKey(capability, version, scope)) ?? [])];
  }

  get(pluginId: string): RegistryEntry | undefined {
    return this.byPlugin.get(pluginId);
  }

  all(): RegistryEntry[] {
    return [...this.byPlugin.values()];
  }

  clear(): void {
    this.byScopedCapability.clear();
    this.byPlugin.clear();
  }
}

export const capabilityRegistry = new CapabilityRegistry();

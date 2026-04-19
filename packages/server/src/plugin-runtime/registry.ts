import { capabilityKey } from "./capabilities";
import type { PluginModule } from "./types";

export interface RegistryEntry {
  pluginId: string;
  module: PluginModule;
  enabled: boolean;
}

/** In-memory capability registry. Rebuilt on install/update/enable/disable. */
export class CapabilityRegistry {
  private byCapability = new Map<string, Set<string>>();
  private byPlugin = new Map<string, RegistryEntry>();

  register(entry: RegistryEntry): void {
    this.byPlugin.set(entry.pluginId, entry);
    if (!entry.enabled) return;
    for (const [capId, capVersion] of Object.entries(entry.module.manifest.capabilities)) {
      const key = capabilityKey(capId, capVersion);
      if (!this.byCapability.has(key)) this.byCapability.set(key, new Set());
      this.byCapability.get(key)!.add(entry.pluginId);
    }
  }

  unregister(pluginId: string): void {
    this.byPlugin.delete(pluginId);
    for (const set of this.byCapability.values()) set.delete(pluginId);
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const entry = this.byPlugin.get(pluginId);
    if (!entry) return;
    entry.enabled = enabled;
    this.unregister(pluginId);
    this.byPlugin.set(pluginId, entry);
    if (enabled) this.register(entry);
  }

  listProviders(capability: string, version: string): string[] {
    return [...(this.byCapability.get(capabilityKey(capability, version)) ?? [])];
  }

  get(pluginId: string): RegistryEntry | undefined {
    return this.byPlugin.get(pluginId);
  }

  all(): RegistryEntry[] {
    return [...this.byPlugin.values()];
  }

  clear(): void {
    this.byCapability.clear();
    this.byPlugin.clear();
  }
}

export const capabilityRegistry = new CapabilityRegistry();

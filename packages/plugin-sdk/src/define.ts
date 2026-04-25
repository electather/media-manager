import type {
  CapabilityDefinition,
  CapabilityMethodSpec,
  CapabilitySpec,
  PluginModule,
} from "./types";

/** Pure identity helper for type inference on plugin modules. */
export function definePlugin<T extends PluginModule>(plugin: T): T {
  return plugin;
}

/** Identity helper for defining a capability as Zod schemas keyed by method. */
export function defineCapability<T extends CapabilityDefinition>(def: T): T {
  return def;
}

/** Helper to build a capability method spec. Optional `meta` carries per-method rules. */
export function method<I extends CapabilitySpec["input"], O extends CapabilitySpec["output"]>(
  input: I,
  output: O,
  meta: Omit<CapabilityMethodSpec, "input" | "output"> = {},
): CapabilityMethodSpec & { input: I; output: O } {
  return { input, output, ...meta };
}

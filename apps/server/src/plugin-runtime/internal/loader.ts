import {
  PluginError,
  validatePluginModule as sdkValidatePluginModule,
  type PluginModule,
  type ValidatedPlugin,
} from "@nama/plugin-sdk";
import { sha256 } from "../../crypto/hash";

/**
 * Built-in plugin modules bundled with the server. Third-party plugins would be loaded
 * from a JS file on disk through a future QuickJS sandbox; the v1 loader only handles
 * the built-ins as regular in-process imports.
 */
export interface BuiltinSource {
  id: string;
  module: PluginModule;
  /** Plain-text bytes used to compute a stable checksum for the `plugins` row. */
  bytes: string;
}

const builtins = new Map<string, BuiltinSource>();

/** Registers a built-in plugin module during server boot. */
export function registerBuiltin(source: BuiltinSource): void {
  builtins.set(source.id, source);
}

export function listBuiltins(): BuiltinSource[] {
  return [...builtins.values()];
}

export function getBuiltin(id: string): BuiltinSource | undefined {
  return builtins.get(id);
}

export interface LoadedPlugin extends ValidatedPlugin {
  checksum: string;
}

/**
 * SDK schema + capability validation plus a checksum for the `plugins` row.
 * Checksum is computed only after validation succeeds so a bad manifest never produces a row.
 */
export async function loadPlugin(module: PluginModule, bytes: string): Promise<LoadedPlugin> {
  const validated = sdkValidatePluginModule(module);
  return { ...validated, checksum: await sha256(bytes) };
}

// Back-compat shim for callers that imported `validatePluginModule` from the
// host-side loader. Forwards to the SDK's validator and (when `bytes` is
// supplied) attaches a checksum so existing call sites keep their old return
// shape. Prefer `loadPlugin` in new code.
export async function validatePluginModule(
  module: PluginModule,
  bytes?: string,
): Promise<LoadedPlugin> {
  const validated = sdkValidatePluginModule(module);
  return { ...validated, checksum: bytes ? await sha256(bytes) : "" };
}

// Re-exported so consumers that imported `PluginError` from this loader path
// keep resolving. New code should import directly from `@nama/plugin-sdk`.
export { PluginError };

import { createHash } from "node:crypto";
import { pluginManifestSchema, isSdkCompatible } from "./manifest";
import { getCapability } from "./capabilities";
import { PluginError } from "./types";
import type { PluginModule } from "./types";

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

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface LoadedPlugin {
  module: PluginModule;
  checksum: string;
  manifestJson: string;
}

/** Full validation pipeline. Throws PluginError on any failure. */
export function validatePluginModule(module: PluginModule, bytes: string): LoadedPlugin {
  const parsed = pluginManifestSchema.safeParse(module.manifest);
  if (!parsed.success) {
    throw new PluginError("INVALID_MANIFEST", parsed.error.message);
  }
  if (!isSdkCompatible(parsed.data.sdkVersion)) {
    throw new PluginError(
      "INCOMPATIBLE_SDK",
      `plugin targets sdkVersion ${parsed.data.sdkVersion} incompatible with host`,
    );
  }

  // Every declared capability must exist in the host catalog at the declared version.
  for (const [capId, capVersion] of Object.entries(parsed.data.capabilities)) {
    const spec = getCapability(capId, capVersion);
    if (!spec) {
      throw new PluginError(
        "UNKNOWN_CAPABILITY",
        `plugin declares unknown capability ${capId}@${capVersion}`,
      );
    }
    const impl = module.capabilities[capId];
    if (!impl) {
      throw new PluginError(
        "MISSING_CAPABILITY_IMPL",
        `plugin manifest claims ${capId} but exports no implementation`,
      );
    }
    for (const methodName of Object.keys(spec.methods)) {
      if (typeof impl[methodName] !== "function") {
        throw new PluginError(
          "MISSING_CAPABILITY_METHOD",
          `${capId}@${capVersion}.${methodName} not implemented`,
        );
      }
    }
  }

  // Every declared job must have a handler.
  for (const job of parsed.data.jobs ?? []) {
    const handler = module.jobs?.[job.handler];
    if (typeof handler !== "function") {
      throw new PluginError(
        "MISSING_JOB_HANDLER",
        `job ${job.id} references handler "${job.handler}" which is not exported`,
      );
    }
  }

  // Auth discipline: plugins with auth.kind != "none" must provide testConnection.
  if (parsed.data.auth.kind !== "none" && typeof module.testConnection !== "function") {
    throw new PluginError("MISSING_TEST_CONNECTION", "plugins with auth require testConnection");
  }

  return {
    module,
    checksum: sha256(bytes),
    manifestJson: JSON.stringify(parsed.data),
  };
}

import { pluginManifestSchema } from "@ent-mcp/shared/plugins";
import { getCapability } from "./capabilities";
import { PluginError } from "./errors/plugin-error";
import type { PluginModule } from "./types";
import { isSdkCompatible } from "./version";

/**
 * Pure validation result returned by `validatePluginModule`. Contains the
 * validated module and the canonical JSON form of its manifest. The host
 * loader adds a checksum on top by hashing the source bytes before persisting
 * the row.
 */
export interface ValidatedPlugin {
  module: PluginModule;
  manifestJson: string;
}

/**
 * Validates a plugin module against the host's plugin contract:
 *
 * - manifest parses against `pluginManifestSchema`
 * - declared `sdkVersion` is compatible with this SDK
 * - every declared capability exists in the SDK catalog at the declared version
 * - every declared capability method has an implementation
 * - every declared job references an exported handler
 * - plugins with `auth.kind !== "none"` export `testConnection`
 * - declared MCP tools have unique names, do not start with `ext_`, fit the
 *   64-char prefixed-name budget, and reference an exported handler
 *
 * Throws `PluginError` on any failure. Used by the server boot loader and by
 * per-plugin contract tests.
 */
export function validatePluginModule(module: PluginModule): ValidatedPlugin {
  const parsed = pluginManifestSchema.safeParse(module.manifest);
  if (!parsed.success) {
    // Manifest authoring failure — plugin author supplied invalid input. Use
    // `plugin.input_invalid` (severity: info), not `plugin.output_invalid`
    // (severity: warning), so the admin error monitor can filter manifest
    // mistakes from runtime malformed-output bugs.
    throw new PluginError("plugin.input_invalid", parsed.error.message);
  }
  if (!isSdkCompatible(parsed.data.sdkVersion)) {
    throw new PluginError(
      "plugin.input_invalid",
      `plugin targets sdkVersion ${parsed.data.sdkVersion} incompatible with host`,
    );
  }

  for (const [capId, cap] of Object.entries(parsed.data.capabilities)) {
    // notificationDelivery is delivery-side, not a dispatched capability — its
    // methods are TypeScript-typed (NotificationMessage, NotificationEvent)
    // rather than zod-validated, so it lives outside the dispatch catalog.
    // Validate the impl shape inline.
    if (capId === "notificationDelivery") {
      if (cap.version !== "v1") {
        throw new PluginError(
          "plugin.missing_method",
          `unknown notificationDelivery version ${cap.version}`,
        );
      }
      const impl = module.capabilities[capId];
      if (!impl) {
        throw new PluginError(
          "plugin.missing_method",
          `plugin manifest claims notificationDelivery but exports no implementation`,
        );
      }
      for (const methodName of ["deliver", "testDelivery"]) {
        if (typeof impl[methodName] !== "function") {
          throw new PluginError(
            "plugin.missing_method",
            `notificationDelivery@${cap.version}.${methodName} not implemented`,
          );
        }
      }
      continue;
    }

    const spec = getCapability(capId, cap.version);
    if (!spec) {
      throw new PluginError(
        "plugin.missing_method",
        `plugin declares unknown capability ${capId}@${cap.version}`,
      );
    }
    const impl = module.capabilities[capId];
    if (!impl) {
      throw new PluginError(
        "plugin.missing_method",
        `plugin manifest claims ${capId} but exports no implementation`,
      );
    }
    for (const [methodName, methodSpec] of Object.entries(spec.methods)) {
      if (typeof impl[methodName] === "function") continue;
      if (methodSpec.optional) continue;
      throw new PluginError(
        "plugin.missing_method",
        `${capId}@${cap.version}.${methodName} not implemented`,
      );
    }
  }

  for (const job of parsed.data.jobs ?? []) {
    const handler = module.jobs?.[job.handler];
    if (typeof handler !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `job ${job.id} references handler "${job.handler}" which is not exported`,
      );
    }
  }

  if (parsed.data.auth.kind !== "none" && typeof module.testConnection !== "function") {
    throw new PluginError("plugin.missing_auth_fn", "plugins with auth require testConnection");
  }

  const seenNames = new Set<string>();
  for (const tool of parsed.data.mcpTools ?? []) {
    if (tool.name.startsWith("ext_")) {
      throw new PluginError(
        "plugin.input_invalid",
        `plugin tool name "${tool.name}" must not start with "ext_" (the host adds the prefix)`,
      );
    }
    if (seenNames.has(tool.name)) {
      throw new PluginError("plugin.input_invalid", `duplicate mcpTool name "${tool.name}"`);
    }
    seenNames.add(tool.name);
    const prefixed = `ext_${parsed.data.id}_${tool.name}`;
    if (prefixed.length > 64) {
      throw new PluginError(
        "plugin.input_invalid",
        `prefixed tool name "${prefixed}" exceeds 64 characters`,
      );
    }
    const handler = module.mcpTools?.[tool.handler];
    if (typeof handler !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `mcpTool "${tool.name}" references handler "${tool.handler}" which is not exported`,
      );
    }
  }

  return {
    module,
    manifestJson: JSON.stringify(parsed.data),
  };
}

import { pluginManifestSchema } from "@nama/shared/plugins";
import type { z } from "zod";
import { getCapability } from "./capabilities";
import { PluginError } from "./errors/plugin-error";
import type { PluginModule } from "./types";
import { isSdkCompatible } from "./version";

type ParsedManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Validated module + canonical manifest JSON. Host adds checksum by hashing
 * source bytes before persisting.
 */
export interface ValidatedPlugin {
  module: PluginModule;
  manifestJson: string;
}

function parseManifest(module: PluginModule): ParsedManifest {
  const parsed = pluginManifestSchema.safeParse(module.manifest);
  if (!parsed.success) {
    // Manifest authoring failure — plugin author supplied invalid input. Use
    // `plugin.input_invalid` (severity: info), not `plugin.output_invalid`
    // (severity: warning), so the admin error monitor can filter manifest
    // mistakes from runtime malformed-output bugs.
    throw new PluginError("plugin.input_invalid", parsed.error.message);
  }
  return parsed.data;
}

function assertSdkCompatible(sdkVersion: string): void {
  if (!isSdkCompatible(sdkVersion)) {
    throw new PluginError(
      "plugin.input_invalid",
      `plugin targets sdkVersion ${sdkVersion} incompatible with host`,
    );
  }
}

// fallow-ignore-next-line complexity
function validateNotificationDelivery(
  capVersion: string,
  impl: Record<string, unknown> | undefined,
): void {
  if (capVersion !== "v1") {
    throw new PluginError(
      "plugin.missing_method",
      `unknown notificationDelivery version ${capVersion}`,
    );
  }
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
        `notificationDelivery@${capVersion}.${methodName} not implemented`,
      );
    }
  }
}

// fallow-ignore-next-line complexity
function validateCatalogCapability(
  capId: string,
  capVersion: string,
  impl: Record<string, unknown> | undefined,
): void {
  const spec = getCapability(capId, capVersion);
  if (!spec) {
    throw new PluginError(
      "plugin.missing_method",
      `plugin declares unknown capability ${capId}@${capVersion}`,
    );
  }
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
      `${capId}@${capVersion}.${methodName} not implemented`,
    );
  }
}

function validateCapabilities(manifest: ParsedManifest, module: PluginModule): void {
  for (const [capId, cap] of Object.entries(manifest.capabilities)) {
    const impl = module.capabilities[capId] as Record<string, unknown> | undefined;
    // notificationDelivery is delivery-side, not a dispatched capability — its
    // methods are TypeScript-typed (NotificationMessage, NotificationEvent)
    // rather than zod-validated, so it lives outside the dispatch catalog.
    // Validate the impl shape inline.
    if (capId === "notificationDelivery") {
      validateNotificationDelivery(cap.version, impl);
    } else {
      validateCatalogCapability(capId, cap.version, impl);
    }
  }
}

// fallow-ignore-next-line complexity
function validateJobs(manifest: ParsedManifest, module: PluginModule): void {
  for (const job of manifest.jobs ?? []) {
    const handler = module.jobs?.[job.handler];
    if (typeof handler !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `job ${job.id} references handler "${job.handler}" which is not exported`,
      );
    }
    // perRowTimeoutSec is a per-row knob — meaningless on global jobs that run
    // a single iteration. Reject loudly instead of silently ignoring.
    if (job.perRowTimeoutSec !== undefined && job.perConnection !== true) {
      throw new PluginError(
        "plugin.input_invalid",
        `job ${job.id} sets perRowTimeoutSec but is not perConnection; the field has no effect on global jobs`,
      );
    }
  }
}

function validateAuth(manifest: ParsedManifest, module: PluginModule): void {
  if (manifest.auth.kind !== "none" && typeof module.testConnection !== "function") {
    throw new PluginError("plugin.missing_auth_fn", "plugins with auth require testConnection");
  }
}

// fallow-ignore-next-line complexity
function validateMcpTools(manifest: ParsedManifest, module: PluginModule): void {
  const seenNames = new Set<string>();
  for (const tool of manifest.mcpTools ?? []) {
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
    const prefixed = `ext_${manifest.id}_${tool.name}`;
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
}

/**
 * Validates manifest shape, SDK compatibility, capability/method coverage,
 * job/MCP-tool handlers, and testConnection for non-none auth. Throws
 * PluginError on failure.
 */
export function validatePluginModule(module: PluginModule): ValidatedPlugin {
  const manifest = parseManifest(module);
  assertSdkCompatible(manifest.sdkVersion);
  validateCapabilities(manifest, module);
  validateJobs(manifest, module);
  validateAuth(manifest, module);
  validateMcpTools(manifest, module);
  return { module, manifestJson: JSON.stringify(manifest) };
}

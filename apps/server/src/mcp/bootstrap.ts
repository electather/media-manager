import { consola } from "consola";
import { MediaRequestV1, MetadataV1 } from "@ent-mcp/plugin-sdk";
import { capabilityRegistry, setMcpLifecycleHooks } from "../plugin-runtime";
import type { PluginModule } from "@ent-mcp/plugin-sdk";
import { callExtension } from "./extension-dispatch";
import {
  mcpToolRegistry,
  registerCapabilityOwnedTools,
  registerCompositeTool,
  registerPluginExtensionTool,
} from "./registry";
import { entDetailsHandler } from "./tool-handlers/ent-details";
import { entRequestHandler } from "./tool-handlers/ent-request";
import { entDiscoverRegistration } from "./composite-tools/ent-discover";
import { entActivityRegistration } from "./composite-tools/ent-activity";
import { entFeedbackRegistration } from "./composite-tools/ent-feedback";
import { entAccountRegistration } from "./host-tools/ent-account";

let bootstrapped = false;

/**
 * Host-owned tool registration. Called once at server boot, after capability
 * and built-in plugin modules are in place. Idempotent: safe to call in tests.
 */
export function bootstrapMcpHostTools(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  registerCapabilityOwnedTools(MetadataV1, { ent_details: entDetailsHandler });
  registerCapabilityOwnedTools(MediaRequestV1, { ent_request: entRequestHandler });
  registerCompositeTool(entDiscoverRegistration);
  registerCompositeTool(entActivityRegistration);
  registerCompositeTool(entFeedbackRegistration);
  registerCompositeTool(entAccountRegistration);

  setMcpLifecycleHooks({
    onPluginEnabled: registerPluginExtensionTools,
    onPluginDisabled: unregisterPluginExtensionTools,
  });

  for (const entry of capabilityRegistry.all()) {
    if (!entry.enabled) continue;
    registerPluginExtensionTools(entry.pluginId, entry.module);
  }

  consola.info(`[mcp] host tools bootstrapped (${mcpToolRegistry.list().length} total)`);
}

/**
 * Registers every `ext_*` tool declared in a plugin's manifest. Called on
 * plugin install/enable; paired with `unregisterPluginExtensionTools` on
 * uninstall/disable so the registry stays consistent.
 */
export function registerPluginExtensionTools(pluginId: string, module: PluginModule): void {
  const tools = module.manifest.mcpTools ?? [];
  for (const tool of tools) {
    const prefixed = `ext_${pluginId}_${tool.name}`;
    registerPluginExtensionTool(pluginId, {
      name: prefixed,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      requiredScopes: ["mcp.ext"],
      annotations: tool.annotations,
      handler: async (ctx, input) =>
        callExtension({
          userId: ctx.userId,
          pluginId,
          handlerKey: tool.handler,
          input,
        }),
    });
  }
  if (tools.length > 0) {
    consola.debug(`[mcp] registered ${tools.length} ext_* tools for plugin ${pluginId}`);
  }
}

export function unregisterPluginExtensionTools(pluginId: string): void {
  mcpToolRegistry.unregisterPlugin(pluginId);
}

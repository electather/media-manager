import { consola } from "consola";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import type { CapabilityDefinition, MCPToolAnnotations } from "../plugin-runtime/types";
import type { JSONSchema } from "../plugin-runtime/types";

const ajv = new Ajv({ allErrors: true, strict: false });

function compile(
  schema: JSONSchema,
  toolName: string,
  which: "input" | "output",
): ValidateFunction {
  try {
    return ajv.compile(schema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid ${which} schema for tool ${toolName}: ${message}`);
  }
}

export interface ToolSource {
  kind: "capability" | "composite" | "extension";
  capabilityId?: string;
  capabilityVersion?: string;
  pluginId?: string;
}

/**
 * The uniform record the dispatcher and `tools/list` emit against. `handler`
 * is pre-bound with whatever context the caller needs (host module for
 * capability/composite tools, `MediaService.callExtension` for `ext_*`).
 */
export interface RegisteredTool {
  name: string;
  source: ToolSource;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  annotations?: MCPToolAnnotations;
  requiredScopes: string[];
  handler: ToolHandler;
  validateInput: ValidateFunction;
  validateOutput: ValidateFunction;
}

export interface ToolCallContext {
  userId: string;
  scopes: string[];
  requestId: string;
}

export type ToolHandler = (ctx: ToolCallContext, input: unknown) => Promise<unknown>;

export interface ToolRegistration {
  name: string;
  source: ToolSource;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  requiredScopes: string[];
  annotations?: MCPToolAnnotations;
  handler: ToolHandler;
}

class McpToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly byPlugin = new Map<string, Set<string>>();

  register(reg: ToolRegistration): void {
    if (this.tools.has(reg.name)) {
      throw new Error(`tool name collision: "${reg.name}" already registered`);
    }
    if (reg.source.kind !== "extension" && reg.name.startsWith("ext_")) {
      throw new Error(`tool "${reg.name}" uses reserved "ext_" prefix`);
    }
    if (reg.description.length > 400) {
      throw new Error(`tool "${reg.name}" description exceeds 400 chars`);
    }
    const validateInput = compile(reg.inputSchema, reg.name, "input");
    const validateOutput = compile(reg.outputSchema, reg.name, "output");
    const record: RegisteredTool = {
      ...reg,
      validateInput,
      validateOutput,
    };
    this.tools.set(reg.name, record);
    if (reg.source.kind === "extension" && reg.source.pluginId) {
      if (!this.byPlugin.has(reg.source.pluginId)) {
        this.byPlugin.set(reg.source.pluginId, new Set());
      }
      this.byPlugin.get(reg.source.pluginId)!.add(reg.name);
    }
  }

  /** Removes all extension tools belonging to a plugin. No-op for other kinds. */
  unregisterPlugin(pluginId: string): void {
    const names = this.byPlugin.get(pluginId);
    if (!names) return;
    for (const name of names) this.tools.delete(name);
    this.byPlugin.delete(pluginId);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  clear(): void {
    this.tools.clear();
    this.byPlugin.clear();
  }
}

export const mcpToolRegistry = new McpToolRegistry();

/**
 * Resolves capability-owned tool handlers from a host-side map. Each capability
 * declares a `handlerKey` in its `mcpTools` entry; the map maps that key to a
 * concrete `ToolHandler`.
 */
export function registerCapabilityOwnedTools(
  capability: CapabilityDefinition,
  handlers: Record<string, ToolHandler>,
): void {
  const tools = capability.mcpTools;
  if (!tools || tools.length === 0) return;
  for (const tool of tools) {
    if (tool.name.startsWith("ext_")) {
      throw new Error(
        `capability ${capability.id}@${capability.version} declares reserved tool name "${tool.name}"`,
      );
    }
    const handler = handlers[tool.handlerKey];
    if (!handler) {
      throw new Error(
        `capability ${capability.id}@${capability.version} references unknown handler "${tool.handlerKey}"`,
      );
    }
    mcpToolRegistry.register({
      name: tool.name,
      source: {
        kind: "capability",
        capabilityId: capability.id,
        capabilityVersion: capability.version,
      },
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      requiredScopes: tool.requiredScopes,
      annotations: tool.annotations,
      handler,
    });
    consola.debug(`[mcp] registered capability tool ${tool.name}`);
  }
}

export function registerPluginExtensionTool(
  pluginId: string,
  reg: Omit<ToolRegistration, "source" | "name"> & { name: string },
): void {
  mcpToolRegistry.register({
    ...reg,
    name: reg.name,
    source: { kind: "extension", pluginId },
  });
  consola.debug(`[mcp] registered extension tool ${reg.name}`);
}

export function registerCompositeTool(
  reg: Omit<ToolRegistration, "source"> & { id: string },
): void {
  mcpToolRegistry.register({
    name: reg.name,
    source: { kind: "composite" },
    description: reg.description,
    inputSchema: reg.inputSchema,
    outputSchema: reg.outputSchema,
    requiredScopes: reg.requiredScopes,
    annotations: reg.annotations,
    handler: reg.handler,
  });
  consola.debug(`[mcp] registered composite tool ${reg.name}`);
}

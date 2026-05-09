import type { UserFacingError } from "@ent-mcp/shared/diagnostics";

/**
 * A tool-dispatch failure carried as an exception inside the MCP pipeline.
 * The dispatcher catches this and converts it into the `UserFacingError`
 * wire shape; elsewhere it behaves like any other Error.
 */
export class McpError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly params?: Record<string, string | number>;

  constructor(
    code: string,
    devMessage: string,
    options: {
      details?: Record<string, unknown>;
      params?: Record<string, string | number>;
      cause?: unknown;
    } = {},
  ) {
    super(devMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "McpError";
    this.code = code;
    this.details = options.details;
    this.params = options.params;
  }

  // fallow-ignore-next-line unused-class-member
  toUserFacing(requestId?: string): UserFacingError {
    return {
      code: this.code,
      devMessage: this.message,
      params: this.params,
      details: this.details,
      requestId,
    };
  }
}

export function ambiguousTarget(
  capability: string,
  candidates: Array<{ connection_id: string; display_name: string | null; plugin_id: string }>,
): McpError {
  return new McpError(
    "mcp.ambiguous_target",
    `User has ${candidates.length} connections for ${capability} and no target specified`,
    {
      params: { capability },
      details: { candidates },
    },
  );
}

export function targetNotFound(target: string, capability: string): McpError {
  return new McpError(
    "mcp.target_not_found",
    `target ${target} is not a valid connection for ${capability}`,
    {
      params: { target, capability },
    },
  );
}

export function forbidden(missingScopes: string[]): McpError {
  return new McpError("mcp.forbidden", `missing required scopes: ${missingScopes.join(", ")}`, {
    details: { missing_scopes: missingScopes },
  });
}

export function invalidId(id: string): McpError {
  return new McpError("mcp.invalid_id", `malformed media id: ${id}`, {
    params: { id },
  });
}

export function notConnected(capability: string): McpError {
  return new McpError("mcp.not_connected", `no connection provides ${capability} for this user`, {
    params: { capability },
    details: {
      capability,
      suggestion: "Connect a provider for this capability in your account settings.",
    },
  });
}

export function rateLimited(retryAfterSec: number): McpError {
  return new McpError("mcp.rate_limited", `rate limit exceeded; retry after ${retryAfterSec}s`, {
    params: { retry_after: retryAfterSec },
    details: { retry_after: retryAfterSec },
  });
}

export function toolNotFound(name: string): McpError {
  return new McpError("mcp.tool_not_found", `tool ${name} is not registered`, {
    params: { name },
  });
}

export function outputInvalid(toolName: string, reason: string): McpError {
  return new McpError(
    "mcp.output_invalid",
    `tool ${toolName} produced output that failed its schema: ${reason}`,
    {
      params: { tool: toolName },
      details: { reason },
    },
  );
}

export function badInput(toolName: string, reason: string): McpError {
  return new McpError("mcp.bad_input", `${toolName}: ${reason}`, {
    params: { tool: toolName },
    details: { reason },
  });
}

/** Codes that represent expected product behavior — not captured as bugs. */
export const EXPECTED_MCP_CODES = new Set<string>([
  "mcp.invalid_id",
  "mcp.forbidden",
  "mcp.ambiguous_target",
  "mcp.target_not_found",
  "mcp.not_connected",
  "mcp.bad_input",
  "mcp.rate_limited",
  "mcp.tool_not_found",
]);

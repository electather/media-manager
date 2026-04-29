import { consola } from "consola";
import { captureError } from "../errors/capture";
import {
  currentRequestContext,
  newRequestId,
  runWithRequestContext,
} from "../errors/request-context";
import type { UserFacingError } from "@ent-mcp/shared/errors";
import { badInput, EXPECTED_MCP_CODES, McpError, outputInvalid, toolNotFound } from "./errors";
import { hasAllScopes, missingScopes } from "./scopes";
import { forbidden } from "./errors";
import { mcpToolRegistry, type RegisteredTool, type ToolCallContext } from "./registry";
import { defaultMcpLimiter } from "./rate-limit";
import { isNil } from "es-toolkit/predicate";

export interface DispatchCaller {
  userId: string;
  scopes: string[];
  /** Optional carrier ID to correlate with upstream request logs. */
  requestId?: string;
}

export interface DispatchResult {
  ok: boolean;
  value?: unknown;
  error?: UserFacingError;
}

function formatAjvErrors(errors: ValidationIssueList): string {
  if (!errors || errors.length === 0) return "schema violation";
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
    .slice(0, 4)
    .join("; ");
}

type ValidationIssueList =
  | Array<{ instancePath?: string; message?: string | null }>
  | undefined
  | null;

function mcpErrorFromUnknown(err: unknown): McpError {
  if (err instanceof McpError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new McpError("http.internal_error", message, { cause: err });
}

async function handleCapturedError(
  err: unknown,
  tool: RegisteredTool,
  caller: DispatchCaller,
  requestId: string,
): Promise<UserFacingError> {
  const mcpErr = mcpErrorFromUnknown(err);
  const shouldCapture = !EXPECTED_MCP_CODES.has(mcpErr.code);
  if (shouldCapture) {
    try {
      await captureError(err, {
        severity: "error",
        source: "backend",
        code: mcpErr.code,
        route: `mcp:${tool.name}`,
        userId: caller.userId,
        pluginId: tool.source.pluginId ?? null,
        requestId,
        context: {
          toolName: tool.name,
          source: tool.source,
        },
      });
    } catch (captureErr) {
      consola.error("[mcp] captureError failed", captureErr);
    }
  }
  return mcpErr.toUserFacing(requestId);
}

/**
 * The shim between the MCP handler and a RegisteredTool. Runs input/output
 * validation, scope check, rate limiting, and error capture. Thrown errors
 * are converted into a `UserFacingError` payload — nothing escapes.
 */
export async function dispatchTool(
  toolName: string,
  caller: DispatchCaller,
  rawInput: unknown,
): Promise<DispatchResult> {
  const tool = mcpToolRegistry.get(toolName);
  const requestId = caller.requestId ?? currentRequestContext()?.requestId ?? newRequestId();

  if (!tool) {
    const err = toolNotFound(toolName);
    return { ok: false, error: err.toUserFacing(requestId) };
  }

  return runWithRequestContext(
    { requestId, userId: caller.userId, route: `mcp:${tool.name}` },
    // fallow-ignore-next-line complexity
    async () => {
      try {
        if (!hasAllScopes(caller.scopes, tool.requiredScopes)) {
          const missing = missingScopes(caller.scopes, tool.requiredScopes);
          const err = forbidden(missing);
          return { ok: false, error: err.toUserFacing(requestId) };
        }

        const limited = defaultMcpLimiter.check(caller.userId);
        if (limited) {
          return { ok: false, error: limited.toUserFacing(requestId) };
        }

        const input = isNil(rawInput) ? {} : rawInput;
        const inputOk = tool.validateInput(input);
        if (!inputOk) {
          const err = badInput(tool.name, formatAjvErrors(tool.validateInput.errors));
          return { ok: false, error: err.toUserFacing(requestId) };
        }

        const ctx: ToolCallContext = {
          userId: caller.userId,
          scopes: caller.scopes,
          requestId,
        };
        const result = await tool.handler(ctx, input);

        const outputOk = tool.validateOutput(result ?? {});
        if (!outputOk) {
          const err = outputInvalid(tool.name, formatAjvErrors(tool.validateOutput.errors));
          const userFacing = await handleCapturedError(err, tool, caller, requestId);
          return { ok: false, error: userFacing };
        }

        return { ok: true, value: result };
      } catch (err) {
        const userFacing = await handleCapturedError(err, tool, caller, requestId);
        return { ok: false, error: userFacing };
      }
    },
  );
}

/**
 * Thin wrapper used by the Streamable HTTP layer: produces the MCP tool
 * result payload whether the dispatch succeeded or failed. Failures are
 * returned as `content: [{ type: "text", text: <serialized error> }]` with
 * `isError: true` per the MCP spec.
 */
export async function dispatchForMcpHandler(
  toolName: string,
  caller: DispatchCaller,
  input: unknown,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  const result = await dispatchTool(toolName, caller, input);
  if (result.ok) {
    const value = (result.value ?? {}) as Record<string, unknown>;
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
    };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: result.error }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Coarse, outcome-oriented MCP scopes. See `docs/mcp-server.md` §6.4.
 * Tools map 1:N to scopes; the dispatcher rejects calls whose JWT scope claim
 * lacks every `requiredScopes` entry for the tool.
 */
export const MCP_SCOPES = [
  "mcp.read",
  "mcp.write.feedback",
  "mcp.write.request",
  "mcp.ext",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

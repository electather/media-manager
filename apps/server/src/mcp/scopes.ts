import { compact } from "es-toolkit/array";

export { MCP_SCOPES, type McpScope } from "@nama/shared/users";

export function parseScopes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return compact(raw.split(/\s+/).map((s) => s.trim()));
}

export function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const set = new Set(granted);
  return required.filter((s) => !set.has(s));
}

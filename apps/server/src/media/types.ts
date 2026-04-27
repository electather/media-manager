import type { HostErrorCode } from "@ent-mcp/shared/errors";

export interface DispatchRequest {
  userId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  /** Optional explicit plugin id (overrides registry enumeration; used by gap-fill). */
  pluginId?: string;
  /** Optional media type for primary-connection lookup (metadata@v1). */
  mediaType?: "movie" | "tv";
  /** Skip cache read/write (e.g. for mutations or forced refresh). */
  skipCache?: boolean;
}

export interface AggregateResult<T> {
  data: T;
  errors: Array<{
    pluginId: string;
    connectionId: string | null;
    code: HostErrorCode;
    devMessage: string;
  }>;
  /**
   * Total number of providers contacted (successes + errors). Lets callers
   * disambiguate "no providers installed" (attempted=0) from "every provider
   * errored" (attempted=errors.length) from "some succeeded but had nothing
   * to contribute" (attempted > errors.length, data empty).
   */
  attempted: number;
}

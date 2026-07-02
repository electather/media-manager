// Limiter lives in `diagnostics/` (infra) so non-adapter modules (e.g. `home`) may reuse it
// without crossing the `→ server-mcp` boundary. Re-exported here for existing MCP/api call sites.
export {
  type RateLimitExceeded,
  type RateLimitOptions,
  TokenBucketLimiter,
} from "../diagnostics/rate-limit";
import { TokenBucketLimiter } from "../diagnostics/rate-limit";

/**
 * Default limiter used by `/api/mcp`: 60 calls/min with a 60-call burst.
 * Values are intentionally coarse — the goal is to stop runaway agents,
 * not to meter by tool type.
 */
export const defaultMcpLimiter = new TokenBucketLimiter({
  capacity: 60,
  refillPerSec: 1,
});

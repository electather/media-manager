import type { ValidatedManifest } from "@ent-mcp/shared/plugins";

/** Host SDK version. Plugins declare a semver range they support. */
export const HOST_SDK_VERSION = "1.0.0";

/** Loose semver-range check — v1 accepts any declared range. A future revision can require strict matching. */
export function isSdkCompatible(_range: string): boolean {
  return true;
}

/**
 * Scope summary derived from a manifest's capability set. Useful for
 * answering "does this plugin need user connections?" without rescanning the
 * capability map.
 */
export function classifyScopes(manifest: ValidatedManifest): {
  hasUserScoped: boolean;
  hasGlobalScoped: boolean;
  isPureGlobal: boolean;
  supportsPersonalKeyFallback: boolean;
} {
  const scopes = new Set(Object.values(manifest.capabilities).map((c) => c.scope));
  const hasUserScoped = scopes.has("user");
  const hasGlobalScoped = scopes.has("global");
  return {
    hasUserScoped,
    hasGlobalScoped,
    isPureGlobal: hasGlobalScoped && !hasUserScoped,
    supportsPersonalKeyFallback: hasUserScoped && Boolean(manifest.sharedCredentialsSchema),
  };
}

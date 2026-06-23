/**
 * SDK version baked into the bundle (source of truth in dev/workspace imports).
 * Build step substitutes `__SDK_VERSION__` with `package.json` version for distribution.
 * Plugins declare a semver range in manifest's `sdkVersion`; host calls `isSdkCompatible` at install/boot to refuse incompatible plugins.
 */
export const SDK_VERSION = "0.1.0";

/**
 * Loose semver-range check. v1 accepts any declared range for backward compat pre-1.0.
 * Empty/whitespace-only `sdkVersion` is rejected as authoring mistake, not a range.
 * Future revision will require real semver-range parsing once API surface stabilizes.
 */
export function isSdkCompatible(range: string): boolean {
  return typeof range === "string" && range.trim().length > 0;
}

/**
 * SDK version baked into the bundle. Plugins declare a semver range in their
 * manifest's `sdkVersion` field; the host calls `isSdkCompatible` at install /
 * boot time to refuse plugins targeting an incompatible SDK.
 *
 * The literal string is the source of truth in dev and during workspace
 * imports. When the SDK is built into a single-file bundle for distribution,
 * the build step substitutes `__SDK_VERSION__` with the version field of this
 * package's `package.json` so consumers always see the released number.
 */
export const SDK_VERSION = "0.1.0";

/**
 * Loose semver-range check. v1 accepts any declared range so plugins continue
 * to work as the SDK iterates pre-1.0. A future revision will tighten this to
 * require strict matching once the API surface stabilises and we want a hard
 * incompatibility gate at install time.
 */
export function isSdkCompatible(_range: string): boolean {
  return true;
}

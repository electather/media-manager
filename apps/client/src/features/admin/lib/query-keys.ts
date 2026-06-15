/**
 * Query-key factory for the admin feature's shared-credentials surfaces.
 *
 * The literal mirrors the parent plugins cache namespace (`["admin",
 * "plugins", …]`) so the credentials list stays a child of the plugin row's
 * cache tree — invalidating the plugin row also drops these entries. The key
 * lives here rather than in the `admin-plugins` feature because the
 * shared-credentials list query is owned by this feature; the architecture
 * boundary forbids `admin` from importing `admin-plugins`.
 */
export const adminKeys = {
  all: ["admin", "plugins"] as const,
  sharedCredentials: (pluginId: string) =>
    [...adminKeys.all, pluginId, "shared-credentials"] as const,
} as const;

export const AUTH_KINDS = ["form", "oauth_redirect", "oauth_device", "none"] as const;

export const CAPABILITY_SCOPES = ["global", "user"] as const;

export const PLUGIN_SOURCE_TYPES = ["builtin", "url"] as const;

export const PERSONAL_KEY_FALLBACK_POLICIES = ["off", "admin-first", "personal-first"] as const;

export type AuthKind = (typeof AUTH_KINDS)[number];
export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];
export type PluginSourceType = (typeof PLUGIN_SOURCE_TYPES)[number];
export type PersonalKeyFallbackPolicy = (typeof PERSONAL_KEY_FALLBACK_POLICIES)[number];

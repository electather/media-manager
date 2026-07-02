import { z } from "zod";
import { AUTH_KINDS, CAPABILITY_SCOPES, PERSONAL_KEY_FALLBACK_POLICIES } from "./enums";
import { NOTIFICATION_CONTENT_KINDS } from "../notifications/enums";
import { isNotificationOnlyPlugin } from "./purpose";

export const authKindSchema = z.enum(AUTH_KINDS);
export const capabilityScopeSchema = z.enum(CAPABILITY_SCOPES);
export const personalKeyFallbackPolicySchema = z.enum(PERSONAL_KEY_FALLBACK_POLICIES);

const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "invalid semver");

const semverRange = z
  .string()
  .min(1)
  .refine((s) => /[\d*^~=<>]/.test(s), "expected a semver range expression");

export const manifestCapabilitySchema = z.object({
  version: z.string().min(1),
  scope: capabilityScopeSchema,
  supportsKinds: z.array(z.enum(NOTIFICATION_CONTENT_KINDS)).optional(),
});

export const manifestJobEntrySchema = z.object({
  id: z.string().min(1),
  schedule: z.string().min(1),
  handler: z.string().min(1),
  perConnection: z.boolean().optional(),
  perRowTimeoutSec: z.number().int().positive().max(1800).optional(),
});

export const mcpToolAnnotationsSchema = z
  .object({
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    readOnlyHint: z.boolean().optional(),
  })
  .optional();

export const mcpToolDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "tool name must be lower snake_case"),
  description: z.string().max(400, "description must be ≤ 400 chars"),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  handler: z.string().min(1),
  annotations: mcpToolAnnotationsSchema,
});

const manifestShape = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be lowercase alphanumeric with dashes"),
  name: z.string().min(1),
  version: semver,
  description: z.string().default(""),
  logoUrl: z.string().url().optional(),
  author: z.object({
    name: z.string().min(1),
    url: z.string().url().optional(),
  }),
  homepage: z.string().url().optional(),
  sdkVersion: semverRange,
  allowedHosts: z.array(z.string().min(1)).default([]),
  globalConfigSchema: z.record(z.string(), z.unknown()).optional(),
  sharedCredentialsSchema: z.record(z.string(), z.unknown()).optional(),
  // Kept in the manifest schema (not stripped) so it reaches sharedCredentialsService,
  // which reads manifest JSON. Value shape validated at load — see validate.ts.
  defaultSharedCredentials: z.unknown().optional(),
  userConfigSchema: z.record(z.string(), z.unknown()).optional(),
  credentialsSchema: z.record(z.string(), z.unknown()).optional(),
  auth: z.object({ kind: authKindSchema }),
  capabilities: z.record(z.string().min(1), manifestCapabilitySchema),
  poolable: z.boolean().optional(),
  jobs: z.array(manifestJobEntrySchema).optional(),
  mcpTools: z.array(mcpToolDefinitionSchema).max(5, "at most 5 mcpTools per plugin").optional(),
});

/**
 * Enforces the table of derived rules: plugin shape is determined by the set of
 * capability scopes, and the other manifest fields must line up with that shape.
 */
// fallow-ignore-next-line complexity
export const pluginManifestSchema = manifestShape.superRefine((manifest, ctx) => {
  const capabilityEntries = Object.entries(manifest.capabilities);
  const scopes = new Set(capabilityEntries.map(([, c]) => c.scope));
  const hasUserScoped = scopes.has("user");
  const hasGlobalScoped = scopes.has("global");
  const isPureGlobal = hasGlobalScoped && !hasUserScoped;
  const hasAnyCapability = scopes.size > 0;

  if (!hasAnyCapability) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "plugin must declare at least one capability",
      path: ["capabilities"],
    });
    return;
  }

  // A bundled default has nothing to validate against without the schema that
  // describes its shape (design §1). Reject at install rather than synthesize
  // an unvalidated entry.
  if (
    manifest.defaultSharedCredentials !== undefined &&
    manifest.sharedCredentialsSchema === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "defaultSharedCredentials requires sharedCredentialsSchema",
      path: ["defaultSharedCredentials"],
    });
  }

  if (isPureGlobal) {
    if (manifest.auth.kind !== "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pure-global plugins must declare auth.kind: "none"',
        path: ["auth", "kind"],
      });
    }
    if (manifest.credentialsSchema !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pure-global plugins must not declare credentialsSchema",
        path: ["credentialsSchema"],
      });
    }
    if (manifest.userConfigSchema !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pure-global plugins must not declare userConfigSchema",
        path: ["userConfigSchema"],
      });
    }
    return;
  }

  // Notification-delivery channels carry auth in `userConfigSchema` (e.g. ntfy `authHeader`, Discord webhook URL).
  // Runtime never mints/refreshes credentials, so `auth.kind: "none"` + missing `credentialsSchema` is intentional.
  // Exempt notificationDelivery-only plugins from credential rules below.
  const userScopedCapabilityIds = capabilityEntries
    .filter(([, c]) => c.scope === "user")
    .map(([id]) => id);

  if (isNotificationOnlyPlugin(userScopedCapabilityIds)) {
    return;
  }

  if (manifest.auth.kind === "none") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'plugins with any user-scoped capability must not declare auth.kind: "none"',
      path: ["auth", "kind"],
    });
  }
  if (manifest.credentialsSchema === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "plugins with any user-scoped capability must declare credentialsSchema",
      path: ["credentialsSchema"],
    });
  }
});

export type ValidatedManifest = z.infer<typeof manifestShape>;

/** Body for `PATCH /admin/plugins/:id/enabled`. */
export const pluginSetEnabledSchema = z.object({ enabled: z.boolean() });

/** Body for `PUT /admin/plugins/:id/global-config`. */
export const pluginGlobalConfigSchema = z.object({ config: z.unknown() });

/** Body for `POST /admin/plugins/:id/shared-credentials`. */
export const pluginAddSharedCredentialSchema = z.object({
  label: z.string().min(1),
  value: z.unknown(),
});

/** Body for `PATCH /admin/plugins/:id/shared-credentials/:credId`. */
export const pluginUpdateSharedCredentialSchema = z.object({
  label: z.string().min(1).optional(),
  value: z.unknown().optional(),
  enabled: z.boolean().optional(),
});

/** Body for `PATCH /admin/plugins/:id/personal-key-fallback`. */
export const pluginPersonalKeyFallbackSchema = z.object({
  policy: personalKeyFallbackPolicySchema,
});

/** Body for `POST /admin/plugins/:id/shared-credentials/test-ephemeral`. */
export const pluginTestEphemeralSharedCredentialSchema = z.object({
  value: z.unknown(),
});

// ─── Admin advanced policy (host allowlist + custom headers) ──────────────────

/** Max allowlist entries per plugin. Bound the payload; admins editing this UI never approach this. */
export const PLUGIN_ADMIN_ALLOWLIST_MAX = 64;

/** Max custom headers per plugin. Same rationale as the allowlist ceiling. */
export const PLUGIN_ADMIN_HEADERS_MAX = 32;

/**
 * Hop-by-hop headers plus a few others the runtime must own. Admins can't
 * override these — setting them would break the transport or duplicate values
 * that `fetch` manages itself.
 */
export const PLUGIN_RESERVED_HEADER_NAMES = [
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
] as const;

const hostnamePattern =
  /^(?:\*|(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;

const adminAllowlistEntrySchema = z
  .string()
  .min(1)
  .max(253)
  .refine((s) => s === s.toLowerCase(), "entry must be lowercase")
  .refine((s) => hostnamePattern.test(s), 'entry must be "*", a hostname, or "*.domain"');

/** Body for `PUT /admin/plugins/:id/admin-allowlist`. */
export const pluginAdminAllowlistSchema = z.object({
  allowlist: z
    .array(adminAllowlistEntrySchema)
    .max(PLUGIN_ADMIN_ALLOWLIST_MAX, `at most ${PLUGIN_ADMIN_ALLOWLIST_MAX} entries`)
    .refine((arr) => new Set(arr).size === arr.length, "duplicate entries")
    .nullable(),
});

// RFC 7230 token: bytes allowed in a header name.
const headerNamePattern = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

const adminHeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((s) => headerNamePattern.test(s), "invalid header name")
  .refine(
    (s) => !(PLUGIN_RESERVED_HEADER_NAMES as readonly string[]).includes(s.toLowerCase()),
    "header is reserved by the runtime",
  );

const adminHeaderValueSchema = z
  .string()
  .min(1, "empty value — delete instead by passing null")
  .max(4096)
  .refine((s) => !/[\r\n]/.test(s), "CR/LF not allowed in header values");

/**
 * Body for `PUT /admin/plugins/:id/admin-headers`. Merge semantics:
 * - Omitted key: preserved at its existing value.
 * - String value: set or replace.
 * - `null` value: delete the header.
 */
export const pluginAdminHeadersSchema = z.object({
  headers: z
    .record(adminHeaderNameSchema, z.union([adminHeaderValueSchema, z.null()]))
    .refine(
      (rec) => Object.keys(rec).length <= PLUGIN_ADMIN_HEADERS_MAX,
      `at most ${PLUGIN_ADMIN_HEADERS_MAX} headers`,
    ),
});

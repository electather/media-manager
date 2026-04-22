import { z } from "zod";
import { AUTH_KINDS, CAPABILITY_SCOPES, PERSONAL_KEY_FALLBACK_POLICIES } from "./enums";

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
});

export const manifestJobEntrySchema = z.object({
  id: z.string().min(1),
  schedule: z.string().min(1),
  handler: z.string().min(1),
  perConnection: z.boolean().optional(),
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
export const pluginManifestSchema = manifestShape.superRefine((manifest, ctx) => {
  const scopes = new Set(Object.values(manifest.capabilities).map((c) => c.scope));
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

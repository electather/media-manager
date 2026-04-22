import { z } from "zod";

/** Host SDK version. Plugins declare a semver range they support. */
export const HOST_SDK_VERSION = "1.0.0";

const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "invalid semver");

const semverRange = z
  .string()
  .min(1)
  .refine((s) => /[\d*^~=<>]/.test(s), "expected a semver range expression");

const authKind = z.enum(["form", "oauth_redirect", "oauth_device", "none"]);
const capabilityScope = z.enum(["global", "user"]);

const manifestCapability = z.object({
  version: z.string().min(1),
  scope: capabilityScope,
});

const jobEntry = z.object({
  id: z.string().min(1),
  schedule: z.string().min(1),
  handler: z.string().min(1),
  perConnection: z.boolean().optional(),
});

const mcpToolAnnotations = z
  .object({
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    readOnlyHint: z.boolean().optional(),
  })
  .optional();

const mcpToolDefinition = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "tool name must be lower snake_case"),
  description: z.string().max(400, "description must be ≤ 400 chars"),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  handler: z.string().min(1),
  annotations: mcpToolAnnotations,
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
  auth: z.object({ kind: authKind }),
  capabilities: z.record(z.string().min(1), manifestCapability),
  poolable: z.boolean().optional(),
  jobs: z.array(jobEntry).optional(),
  mcpTools: z.array(mcpToolDefinition).max(5, "at most 5 mcpTools per plugin").optional(),
});

/**
 * Enforces the table of derived rules from the design doc: plugin shape is
 * determined by the set of capability scopes, and the other manifest fields
 * must line up with that shape.
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
} {
  const scopes = new Set(Object.values(manifest.capabilities).map((c) => c.scope));
  const hasUserScoped = scopes.has("user");
  const hasGlobalScoped = scopes.has("global");
  return { hasUserScoped, hasGlobalScoped, isPureGlobal: hasGlobalScoped && !hasUserScoped };
}

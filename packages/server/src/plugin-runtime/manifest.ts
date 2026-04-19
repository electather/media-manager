import { z } from "zod";

/** Host SDK version. Plugins declare a semver range they support. */
export const HOST_SDK_VERSION = "1.0.0";

const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "invalid semver");

const semverRange = z
  .string()
  .min(1)
  .refine((s) => /[\d*^~=<>]/.test(s), "expected a semver range expression");

const authKind = z.enum(["form", "oauth_redirect", "oauth_device", "none"]);

const jobEntry = z.object({
  id: z.string().min(1),
  schedule: z.string().min(1),
  handler: z.string().min(1),
  perConnection: z.boolean().optional(),
});

export const pluginManifestSchema = z.object({
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
  globalConfigSchema: z.record(z.unknown()).optional(),
  userConfigSchema: z.record(z.unknown()).optional(),
  credentialsSchema: z.record(z.unknown()),
  allowsSharedCredentials: z.boolean().optional(),
  auth: z.object({ kind: authKind }),
  capabilities: z.record(z.string()),
  jobs: z.array(jobEntry).optional(),
});

export type ValidatedManifest = z.infer<typeof pluginManifestSchema>;

/** Loose semver-range check — v1 accepts any declared range. A future revision can require strict matching. */
export function isSdkCompatible(_range: string): boolean {
  return true;
}

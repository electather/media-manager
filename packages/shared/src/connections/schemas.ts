import { z } from "zod";
import { CONNECTION_STATUSES } from "./enums";
import { MEDIA_TYPES } from "../media/enums";

export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

// Wire-level shape uses `null` for "no media-type partition" so the JSON
// payload stays clean — `primary-preference.ts` maps it to the DB sentinel "_".
const optionalMediaTypeSchema = z.enum(MEDIA_TYPES).nullable();

// Matches every capability id we ship (`metadata@v1`, `artwork@v1`, …). A
// hyphenated capability would fail here; documented in plan RISK-003.
const capabilityKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*@v\d+$/);

/** Body for `POST /api/connections/primary`. */
export const primaryConnectionSetSchema = z.object({
  capabilityKey: capabilityKeySchema,
  mediaType: optionalMediaTypeSchema,
  connectionId: z.string().uuid(),
});
export type PrimaryConnectionSetBody = z.infer<typeof primaryConnectionSetSchema>;

/** Body for `DELETE /api/connections/primary`. */
export const primaryConnectionClearSchema = z.object({
  capabilityKey: capabilityKeySchema,
  mediaType: optionalMediaTypeSchema,
});
export type PrimaryConnectionClearBody = z.infer<typeof primaryConnectionClearSchema>;

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** Body for `POST /api/connections`. */
export const connectionCreateSchema = z.object({
  pluginId: z.string(),
  userConfig: z.unknown(),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
});
export type ConnectionCreateBody = z.infer<typeof connectionCreateSchema>;

/** Body for `POST /api/connections/verify-config`. */
export const connectionVerifyConfigSchema = z.object({
  pluginId: z.string(),
  userConfig: z.unknown(),
});
export type ConnectionVerifyConfigBody = z.infer<typeof connectionVerifyConfigSchema>;

export const connectionDisplayNameSchema = z.object({
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});
export const connectionUserConfigSchema = z.object({
  userConfig: z.unknown(),
});
export const connectionEnabledSchema = z.object({
  enabled: z.boolean(),
});

/** Bodies for OAuth flows under `/api/connections/oauth/*`. */
export const oauthDeviceStartSchema = z.object({ pluginId: z.string() });
export const oauthDevicePollSchema = z.object({ nonce: z.string() });
export const oauthRedirectStartSchema = z.object({ pluginId: z.string() });
export const oauthRedirectCompleteSchema = z.object({
  nonce: z.string(),
  queryParams: z.record(z.string(), z.string()),
});

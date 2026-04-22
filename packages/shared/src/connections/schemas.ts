import { z } from "zod";
import { CONNECTION_STATUSES } from "./enums";

export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

/** Body for `POST /api/connections`. */
export const connectionCreateSchema = z.object({
  pluginId: z.string(),
  userConfig: z.unknown(),
  displayName: z.string().optional(),
});
export type ConnectionCreateBody = z.infer<typeof connectionCreateSchema>;

/** Body for `POST /api/connections/verify-config`. */
export const connectionVerifyConfigSchema = z.object({
  pluginId: z.string(),
  userConfig: z.unknown(),
});
export type ConnectionVerifyConfigBody = z.infer<typeof connectionVerifyConfigSchema>;

export const connectionDisplayNameSchema = z.object({
  displayName: z.string().min(1),
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

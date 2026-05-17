import { z } from "zod";
import type { EventName } from "../jobs/events";

/**
 * Cross-module events emitted by `media/`. Consumers import the constant and
 * the payload schema from `../media` (barrel) — never from this file directly.
 */
export const MEDIA_EVENTS = {
  CONNECTION_AUTH_EXPIRED: "media.connection.auth-expired" as EventName,
} as const;

export const connectionAuthExpiredPayload = z.object({
  connectionId: z.string(),
  pluginId: z.string(),
  userId: z.string(),
});
export type ConnectionAuthExpiredPayload = z.infer<typeof connectionAuthExpiredPayload>;

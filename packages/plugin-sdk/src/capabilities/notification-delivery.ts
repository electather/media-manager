import type { NotificationMessage, NotificationEvent } from "@nama/shared/notifications";
import type { PluginContext } from "../types";

/**
 * notificationDelivery@v1 — ship notifications to external services.
 * Host injects pre-rendered NotificationMessage + raw event (for plugin-specific rendering).
 */
export interface NotificationDeliveryCapabilityV1<TConfig = unknown> {
  /**
   * Render and ship a single notification. Throw to trigger retry.
   * Returns a provider-side id when available (used for future read-receipts).
   */
  deliver(
    ctx: PluginContext<unknown, unknown, TConfig>,
    args: {
      message: NotificationMessage; // pre-rendered neutral payload
      event: NotificationEvent; // raw typed event for plugin-specific rendering
      channelConfig: TConfig; // decrypted, validated against userConfigSchema
    },
  ): Promise<{ providerMessageId?: string }>;

  /**
   * Validate config + verify reachability (UI "Test" button, channel-create).
   * May send a probe message (e.g. "Test from Nama") only if needed for end-to-end proof;
   * silent checks risk false positives (read access ≠ write access).
   */
  testDelivery(
    ctx: PluginContext<unknown, unknown, TConfig>,
    args: { channelConfig: TConfig },
  ): Promise<{ ok: boolean; message?: string }>;
}

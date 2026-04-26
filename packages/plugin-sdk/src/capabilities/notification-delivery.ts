import type { NotificationMessage, NotificationEvent } from "@ent-mcp/shared/notifications";
import type { PluginContext } from "../types";

/**
 * notificationDelivery@v1 — ship notifications to external services.
 * Plugins expose two methods: deliver() to send the message, and testDelivery()
 * to validate config. The host injects a pre-rendered NotificationMessage
 * alongside the raw event for plugins that need event-specific rendering.
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
   * Validate config + verify reachability. Called from the "Test" button in UI
   * and once at channel-create time. Should NOT actually deliver.
   */
  testDelivery(
    ctx: PluginContext<unknown, unknown, TConfig>,
    args: { channelConfig: TConfig },
  ): Promise<{ ok: boolean; message?: string }>;
}

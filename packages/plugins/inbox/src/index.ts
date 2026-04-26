import { definePlugin } from "@ent-mcp/plugin-sdk";
import type { NotificationMessage, NotificationEvent } from "@ent-mcp/shared/notifications";

export const inboxPlugin = definePlugin({
  manifest: {
    id: "inbox",
    name: "In-app inbox",
    description: "Receive notifications in your in-app inbox.",
    version: "0.1.0",
    sdkVersion: "^1.0.0",
    author: { name: "Anthropic" },
    allowedHosts: [],
    auth: { kind: "none" },
    capabilities: {
      notificationDelivery: {
        version: "v1",
        scope: "user",
        supportsKinds: ["text", "markdown", "image", "actions"],
      },
    },
    userConfigSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  capabilities: {
    notificationDelivery: {
      deliver: async (ctx, args) => {
        const { message, deliveryId, recipientUserId } = args as {
          message: NotificationMessage;
          event?: NotificationEvent;
          deliveryId?: string;
          recipientUserId?: string;
          channelConfig: unknown;
        };

        if (!recipientUserId) throw new Error("recipientUserId required for inbox delivery");

        await (ctx as any).inbox.insert({
          userId: recipientUserId,
          deliveryId: deliveryId ?? null,
          title: message.title,
          body: message.body,
          severity: message.severity,
          category: message.category,
          actionUrl: message.actionUrl ?? null,
          imageUrl: message.image?.url ?? null,
          imageAlt: message.image?.alt ?? null,
        });

        return {};
      },
      testDelivery: async () => {
        return { ok: true };
      },
    },
  },
});

export default inboxPlugin;

import { definePlugin } from "@nama/plugin-sdk";
import type { NotificationEvent, NotificationMessage } from "@nama/shared/notifications";

/**
 * Host-privileged inbox capability injected onto the plugin context by the
 * server. The plugin only knows about message fields; the host pre-binds the
 * recipient user id and delivery id so third-party plugins (which never
 * receive `ctx.inbox`) cannot persist server-owned state.
 */
interface InboxInsertArgs {
  title: string;
  body: string;
  severity: NotificationMessage["severity"];
  category: NotificationMessage["category"];
  actionUrl?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

interface InboxContext {
  inbox: { insert: (row: InboxInsertArgs) => Promise<void> };
}

interface DeliverArgs {
  message: NotificationMessage;
  event: NotificationEvent;
  channelConfig: unknown;
}

function inboxFromCtx(ctx: unknown): InboxContext["inbox"] {
  const candidate = (ctx as Partial<InboxContext>).inbox;
  if (!candidate || typeof candidate.insert !== "function") {
    throw new Error("inbox plugin requires host-privileged ctx.inbox to be injected");
  }
  return candidate;
}

export const inboxPlugin = definePlugin({
  manifest: {
    id: "inbox",
    name: "In-app inbox",
    description: "Receive notifications in your in-app inbox.",
    version: "0.2.0",
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
        const { message } = args as DeliverArgs;
        const inbox = inboxFromCtx(ctx);
        await inbox.insert({
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
      testDelivery: async () => ({ ok: true }),
    },
  },
});

export default inboxPlugin;

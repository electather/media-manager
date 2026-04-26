import { definePlugin, pluginError, type PluginContext } from "@ent-mcp/plugin-sdk";
import type {
  NotificationAction,
  NotificationEvent,
  NotificationMessage,
} from "@ent-mcp/shared/notifications";

interface DiscordUserCfg {
  webhookUrl: string;
}

interface DeliverArgs {
  message: NotificationMessage;
  event: NotificationEvent;
  channelConfig: DiscordUserCfg;
}

interface TestArgs {
  channelConfig: DiscordUserCfg;
}

type Ctx = PluginContext<unknown, unknown, DiscordUserCfg>;

const COLOR_BY_SEVERITY: Record<NotificationMessage["severity"], number> = {
  info: 0x3b82f6,
  warn: 0xf59e0b,
  error: 0xef4444,
};

function parseRetryAfterMs(res: Response, body: unknown): number | undefined {
  // Discord returns `retry_after` (seconds, can be fractional) inside the
  // JSON body. Prefer it; fall back to the standard header.
  if (typeof body === "object" && body !== null && "retry_after" in body) {
    const seconds = Number((body as { retry_after?: unknown }).retry_after);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

function throwForDiscordStatus(res: Response, body: unknown): never {
  const rawMessage =
    typeof body === "object" && body !== null && "message" in body
      ? (body as { message?: unknown }).message
      : undefined;
  const message = typeof rawMessage === "string" ? rawMessage : "";

  if (res.status === 429) {
    throw pluginError("plugin.rate_limited", `discord 429 ${message}`.trim(), {
      retryable: true,
      retryAfterMs: parseRetryAfterMs(res, body),
    });
  }
  if (res.status >= 500) {
    throw pluginError("plugin.upstream_error", `discord ${res.status} ${message}`.trim(), {
      retryable: true,
    });
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw pluginError(
      "plugin.bad_credentials",
      `discord webhook rejected (${res.status}) ${message}`.trim(),
      { retryable: false },
    );
  }
  throw pluginError("plugin.upstream_error", `discord ${res.status} ${message}`.trim(), {
    retryable: false,
  });
}

/**
 * Discord interactive components are organised as action rows of up to five
 * buttons. We use link buttons (style 5) so the recipient can navigate to the
 * action's URL without granting the webhook a bot token. Buttons beyond the
 * row capacity wrap into additional rows.
 */
function componentsFromActions(actions: NotificationAction[] | undefined) {
  if (!actions || actions.length === 0) return undefined;
  const rows: Array<{ type: 1; components: Array<Record<string, unknown>> }> = [];
  for (let i = 0; i < actions.length; i += 5) {
    rows.push({
      type: 1,
      components: actions.slice(i, i + 5).map((a) => ({
        type: 2,
        style: 5,
        label: a.label,
        url: a.url,
      })),
    });
  }
  return rows;
}

function buildEmbed(message: NotificationMessage) {
  const description = message.bodyMarkdown ?? message.body;
  const embed: Record<string, unknown> = {
    title: message.title,
    description,
    color: COLOR_BY_SEVERITY[message.severity],
  };
  if (message.actionUrl) embed.url = message.actionUrl;
  if (message.image?.url) embed.image = { url: message.image.url };
  if (message.thumbnail?.url) embed.thumbnail = { url: message.thumbnail.url };
  return embed;
}

function appendWaitParam(webhookUrl: string): string {
  // `?wait=true` makes Discord respond with the created message JSON instead
  // of a bare 204 — needed so we can capture `providerMessageId`.
  const sep = webhookUrl.includes("?") ? "&" : "?";
  return `${webhookUrl}${sep}wait=true`;
}

export const discordPlugin = definePlugin({
  manifest: {
    id: "discord",
    name: "Discord",
    description: "Send notifications to a Discord channel via an incoming webhook.",
    version: "0.1.0",
    sdkVersion: "^1.0.0",
    author: { name: "Media Manager" },
    allowedHosts: ["discord.com", "*.discord.com"],
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
      properties: {
        webhookUrl: {
          type: "string",
          format: "uri",
          title: "Webhook URL",
          description:
            "Incoming webhook URL from Discord (Channel → Integrations → Webhooks → New Webhook).",
          "x-secret": true,
        },
      },
      required: ["webhookUrl"],
      additionalProperties: false,
    },
  },
  capabilities: {
    notificationDelivery: {
      deliver: async (ctx, args) => {
        const c = ctx as Ctx;
        const { message, channelConfig: cfg } = args as DeliverArgs;
        const components = componentsFromActions(message.actions);
        const body: Record<string, unknown> = {
          embeds: [buildEmbed(message)],
          ...(components ? { components } : {}),
        };

        const res = await c.fetch(appendWaitParam(cfg.webhookUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) throwForDiscordStatus(res, json);

        const rawId =
          typeof json === "object" && json !== null && "id" in json
            ? (json as { id?: unknown }).id
            : undefined;
        const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
        return id ? { providerMessageId: id } : {};
      },

      testDelivery: async (ctx, args) => {
        const c = ctx as Ctx;
        const { channelConfig: cfg } = args as TestArgs;
        // GET on a Discord webhook returns the webhook metadata when the URL
        // and token are valid, and 401/404 otherwise — no message is posted.
        const res = await c.fetch(cfg.webhookUrl, { method: "GET" });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          return { ok: false, message: `discord webhook rejected (${res.status})` };
        }
        if (!res.ok) return { ok: false, message: `discord ${res.status}` };
        return { ok: true };
      },
    },
  },
});

export default discordPlugin;

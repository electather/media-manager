import { definePlugin, pluginError, type PluginContext } from "@ent-mcp/plugin-sdk";
import type {
  NotificationAction,
  NotificationEvent,
  NotificationMessage,
} from "@ent-mcp/shared/notifications";

interface TelegramUserCfg {
  botToken: string;
  chatId: string;
}

interface DeliverArgs {
  message: NotificationMessage;
  event: NotificationEvent;
  channelConfig: TelegramUserCfg;
}

interface TestArgs {
  channelConfig: TelegramUserCfg;
}

type Ctx = PluginContext<unknown, unknown, TelegramUserCfg>;

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Reserved characters in Telegram's MarkdownV2 that must be backslash-escaped
 * when sent in a non-formatting role. Source: https://core.telegram.org/bots/api#markdownv2-style.
 * We escape every reserved character because the message body is built from
 * untrusted upstream payload fields (titles, usernames, errors).
 */
const MARKDOWN_V2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_RESERVED, (m) => `\\${m}`);
}

function parseRetryAfterMs(res: Response, body: unknown): number | undefined {
  // Telegram returns Retry-After both as a header and as
  // `parameters.retry_after` (seconds) inside the JSON body. Prefer the body
  // because the docs guarantee it; fall back to the header.
  const fromBody =
    typeof body === "object" && body !== null && "parameters" in body
      ? Number((body as { parameters?: { retry_after?: number } }).parameters?.retry_after)
      : NaN;
  if (Number.isFinite(fromBody) && fromBody >= 0) return Math.round(fromBody * 1000);
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

function throwForTelegramStatus(res: Response, body: unknown): never {
  const rawDescription =
    typeof body === "object" && body !== null && "description" in body
      ? (body as { description?: unknown }).description
      : undefined;
  const description = typeof rawDescription === "string" ? rawDescription : "";

  if (res.status === 429) {
    throw pluginError("plugin.rate_limited", `telegram 429 ${description}`.trim(), {
      retryable: true,
      retryAfterMs: parseRetryAfterMs(res, body),
    });
  }
  if (res.status >= 500) {
    throw pluginError("plugin.upstream_error", `telegram ${res.status} ${description}`.trim(), {
      retryable: true,
    });
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw pluginError(
      "plugin.bad_credentials",
      `telegram auth rejected (${res.status}) ${description}`.trim(),
      { retryable: false },
    );
  }
  // 400 (bad request, missing param) is a configuration bug — not retryable.
  throw pluginError("plugin.upstream_error", `telegram ${res.status} ${description}`.trim(), {
    retryable: false,
  });
}

function inlineKeyboardFromActions(actions: NotificationAction[] | undefined) {
  if (!actions || actions.length === 0) return undefined;
  return { inline_keyboard: actions.map((a) => [{ text: a.label, url: a.url }]) };
}

interface TelegramSuccess {
  ok: true;
  result: { message_id: number };
}

function readMessageId(json: unknown): string | undefined {
  if (
    typeof json === "object" &&
    json !== null &&
    (json as TelegramSuccess).ok === true &&
    typeof (json as TelegramSuccess).result?.message_id === "number"
  ) {
    return String((json as TelegramSuccess).result.message_id);
  }
  return undefined;
}

async function callTelegram<T = unknown>(
  ctx: Ctx,
  cfg: TelegramUserCfg,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${TELEGRAM_API_BASE}/bot${encodeURIComponent(cfg.botToken)}/${method}`;
  const res = await ctx.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throwForTelegramStatus(res, json);
  return json as T;
}

export const telegramPlugin = definePlugin({
  manifest: {
    id: "telegram",
    name: "Telegram",
    description: "Send notifications to a Telegram chat via a bot.",
    version: "0.1.0",
    sdkVersion: "^1.0.0",
    author: { name: "Media Manager" },
    allowedHosts: ["api.telegram.org"],
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
        botToken: {
          type: "string",
          title: "Bot token",
          description: "API token issued by @BotFather (e.g. 123456:ABC-...).",
          "x-secret": true,
        },
        chatId: {
          type: "string",
          title: "Chat ID",
          description: "Target chat id (numeric) or @channel_username.",
        },
      },
      required: ["botToken", "chatId"],
      additionalProperties: false,
    },
  },
  capabilities: {
    notificationDelivery: {
      deliver: async (ctx, args) => {
        const c = ctx as Ctx;
        const { message, channelConfig: cfg } = args as DeliverArgs;
        const replyMarkup = inlineKeyboardFromActions(message.actions);
        const useMarkdown = typeof message.bodyMarkdown === "string";

        if (message.image?.url) {
          // Image events use sendPhoto. Telegram caption is limited to 1024
          // chars but the host's templates produce short strings, so no
          // truncation logic here.
          const caption = useMarkdown
            ? message.bodyMarkdown!
            : `*${escapeMarkdownV2(message.title)}*\n${escapeMarkdownV2(message.body)}`;
          const json = await callTelegram(c, cfg, "sendPhoto", {
            chat_id: cfg.chatId,
            photo: message.image.url,
            caption,
            parse_mode: "MarkdownV2",
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
          const id = readMessageId(json);
          return id ? { providerMessageId: id } : {};
        }

        const text = useMarkdown
          ? message.bodyMarkdown!
          : `*${escapeMarkdownV2(message.title)}*\n${escapeMarkdownV2(message.body)}`;
        const json = await callTelegram(c, cfg, "sendMessage", {
          chat_id: cfg.chatId,
          text,
          parse_mode: "MarkdownV2",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        const id = readMessageId(json);
        return id ? { providerMessageId: id } : {};
      },

      testDelivery: async (ctx, args) => {
        const c = ctx as Ctx;
        const { channelConfig: cfg } = args as TestArgs;
        // getMe is the canonical reachability + auth check; it does not
        // produce any chat-visible side-effect.
        const url = `${TELEGRAM_API_BASE}/bot${encodeURIComponent(cfg.botToken)}/getMe`;
        const res = await c.fetch(url, { method: "GET" });
        if (res.status === 401) return { ok: false, message: "telegram bot token rejected" };
        if (!res.ok) return { ok: false, message: `telegram ${res.status}` };
        return { ok: true };
      },
    },
  },
});

export default telegramPlugin;

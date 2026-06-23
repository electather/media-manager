import { definePlugin, pluginError, type PluginContext } from "@nama/plugin-sdk";
import type {
  NotificationAction,
  NotificationEvent,
  NotificationMessage,
} from "@nama/shared/notifications";

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

/** MarkdownV2 reserved chars requiring backslash-escape (https://core.telegram.org/bots/api#markdownv2-style). Escape all because body is built from untrusted fields (titles, usernames, errors). */
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
    author: { name: "Nama" },
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
        const chatIdRedacted = redactChatId(cfg.chatId);
        c.log.info("deliver: start", {
          chatId: chatIdRedacted,
          kind: message.image?.url ? "photo" : "text",
          hasMarkdown: useMarkdown,
          actionCount: message.actions?.length ?? 0,
        });

        try {
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
            c.log.info("deliver: ok", { method: "sendPhoto", providerMessageId: id ?? null });
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
          c.log.info("deliver: ok", { method: "sendMessage", providerMessageId: id ?? null });
          return id ? { providerMessageId: id } : {};
        } catch (err) {
          // Re-throw so the host's retry/backoff policy kicks in, but log
          // first so the failure is visible without parsing the runner's
          // captured error payload.
          c.log.error("deliver: failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },

      testDelivery: async (ctx, args) => {
        const c = ctx as Ctx;
        const { channelConfig: cfg } = args as TestArgs;
        const base = `${TELEGRAM_API_BASE}/bot${encodeURIComponent(cfg.botToken)}`;
        const chatIdRedacted = redactChatId(cfg.chatId);
        c.log.info("testDelivery: start", { chatId: chatIdRedacted });

        // 1. getMe validates botToken. Telegram returns 401 when the token
        // is malformed/revoked and 404 when the bot id doesn't exist; both
        // surface to the user as a rejected token.
        const meRes = await c.fetch(`${base}/getMe`, { method: "GET" });
        if (meRes.status === 401 || meRes.status === 404) {
          c.log.warn("testDelivery: getMe rejected", { status: meRes.status });
          return { ok: false, message: "telegram bot token rejected" };
        }
        if (!meRes.ok) {
          c.log.warn("testDelivery: getMe non-2xx", { status: meRes.status });
          return { ok: false, message: `telegram getMe ${meRes.status}` };
        }
        c.log.debug("testDelivery: getMe ok");

        // 2. getChat validates chatId + bot reachability without producing
        // any chat-visible side-effect. Passing this step means the bot can
        // see the chat, but it does not prove the bot can write to it
        // (channels with restricted posting, supergroups with locked threads,
        // etc.).
        const chatRes = await c.fetch(`${base}/getChat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: cfg.chatId }),
        });
        if (!chatRes.ok) {
          const body = (await chatRes.json().catch(() => null)) as {
            description?: string;
          } | null;
          const desc =
            typeof body?.description === "string" && body.description.length > 0
              ? `telegram: ${body.description}`
              : `telegram getChat ${chatRes.status}`;
          c.log.warn("testDelivery: getChat failed", { status: chatRes.status, description: desc });
          return { ok: false, message: desc };
        }
        c.log.debug("testDelivery: getChat ok");

        // 3. Send a real test message so the user can confirm end-to-end
        // delivery (a passing getChat probe alone has produced false
        // positives — bots can read chats they cannot post to). Kept short
        // so users in shared chats see something obviously diagnostic.
        const sendRes = await c.fetch(`${base}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: cfg.chatId,
            text: "✅ Test from Nama — Telegram channel is wired up.",
            disable_notification: true,
          }),
        });
        if (!sendRes.ok) {
          const body = (await sendRes.json().catch(() => null)) as {
            description?: string;
          } | null;
          const desc =
            typeof body?.description === "string" && body.description.length > 0
              ? `telegram: ${body.description}`
              : `telegram sendMessage ${sendRes.status}`;
          c.log.warn("testDelivery: sendMessage failed", {
            status: sendRes.status,
            description: desc,
          });
          return { ok: false, message: desc };
        }
        c.log.info("testDelivery: sendMessage ok");
        return { ok: true };
      },
    },
  },
});

/**
 * Redacts the chat id for logs. Telegram chat ids are not strictly secret
 * (they appear in webhook payloads, group invite links, etc.), but they still
 * identify a target chat — keep only the trailing 4 chars so log lines remain
 * useful for diagnosing the right channel without making the full id grep-able.
 */
function redactChatId(chatId: string): string {
  if (chatId.length <= 4) return chatId;
  return `***${chatId.slice(-4)}`;
}

export default telegramPlugin;

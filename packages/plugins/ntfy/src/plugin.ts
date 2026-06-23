import { definePlugin, pluginError, type PluginContext } from "@nama/plugin-sdk";
import type {
  NotificationAction,
  NotificationEvent,
  NotificationMessage,
} from "@nama/shared/notifications";

interface NtfyUserCfg {
  serverUrl: string;
  topic: string;
  authHeader?: string;
}

interface DeliverArgs {
  message: NotificationMessage;
  event: NotificationEvent;
  channelConfig: NtfyUserCfg;
}

interface TestArgs {
  channelConfig: NtfyUserCfg;
}

type Ctx = PluginContext<unknown, unknown, NtfyUserCfg>;

/**
 * Resolves the per-attempt delay an upstream's `Retry-After` header asks the
 * client to wait. The header is either an integer seconds value or an
 * HTTP-date; we accept both and return milliseconds. Returns `undefined` when
 * the header is absent or unparseable so the caller falls back to the
 * configured backoff schedule.
 */
function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * Translates an ntfy HTTP response into a `pluginError` carrying the retry
 * semantics that the delivery job cares about. 429/5xx are retryable;
 * 401/403/404 (typo'd topic, revoked token) are terminal.
 */
function throwForNtfyStatus(res: Response, body: string): never {
  if (res.status === 429) {
    throw pluginError("plugin.rate_limited", `ntfy 429 ${body}`.trim(), {
      retryable: true,
      retryAfterMs: parseRetryAfterMs(res),
    });
  }
  if (res.status >= 500) {
    throw pluginError("plugin.upstream_error", `ntfy ${res.status} ${body}`.trim(), {
      retryable: true,
    });
  }
  if (res.status === 401 || res.status === 403) {
    throw pluginError("plugin.bad_credentials", `ntfy auth rejected (${res.status})`, {
      retryable: false,
    });
  }
  if (res.status === 404) {
    throw pluginError("plugin.bad_credentials", `ntfy endpoint not found (404)`, {
      retryable: false,
    });
  }
  throw pluginError("plugin.upstream_error", `ntfy ${res.status} ${body}`.trim(), {
    retryable: false,
  });
}

const PRIORITY_BY_SEVERITY: Record<NotificationMessage["severity"], string> = {
  info: "3",
  warn: "4",
  error: "5",
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// Encodes ntfy view-actions per https://docs.ntfy.sh/publish/#using-a-header.
// Format: `view, <label>, <url>` joined by `;`. Commas/semis in labels are
// stripped — ntfy uses them as separators with no escape mechanism.
function formatActionsHeader(actions: NotificationAction[]): string {
  return actions.map((a) => `view, ${a.label.replace(/[,;]/g, " ")}, ${a.url}`).join("; ");
}

export const ntfyPlugin = definePlugin({
  manifest: {
    id: "ntfy",
    name: "ntfy",
    description: "Self-hosted push notifications via ntfy.",
    version: "0.1.0",
    sdkVersion: "^1.0.0",
    author: { name: "Nama" },
    allowedHosts: [],
    auth: { kind: "none" },
    capabilities: {
      notificationDelivery: {
        version: "v1",
        scope: "user",
        supportsKinds: ["text", "image", "actions"],
      },
    },
    userConfigSchema: {
      type: "object",
      properties: {
        serverUrl: {
          type: "string",
          format: "uri",
          title: "ntfy server URL",
          description: "Base URL of your ntfy instance (e.g. https://ntfy.sh).",
          "x-allowed-host": true,
        },
        topic: {
          type: "string",
          title: "Topic",
          minLength: 1,
        },
        authHeader: {
          type: "string",
          title: "Auth header",
          description:
            "Optional Authorization header value (e.g. 'Bearer tk_...' or 'Basic base64(user:pass)').",
          "x-secret": true,
        },
      },
      required: ["serverUrl", "topic"],
      additionalProperties: false,
    },
  },
  capabilities: {
    notificationDelivery: {
      deliver: async (ctx, args) => {
        const c = ctx as Ctx;
        const { message, channelConfig: cfg } = args as DeliverArgs;
        const url = `${trimTrailingSlash(cfg.serverUrl)}/${encodeURIComponent(cfg.topic)}`;

        const headers: Record<string, string> = {
          Title: message.title,
          Priority: PRIORITY_BY_SEVERITY[message.severity],
          Tags: message.category,
        };
        if (message.actionUrl) headers["Click"] = message.actionUrl;
        if (message.image?.url) headers["Attach"] = message.image.url;
        if (message.actions && message.actions.length > 0) {
          headers["Actions"] = formatActionsHeader(message.actions);
        }
        if (cfg.authHeader) headers["Authorization"] = cfg.authHeader;

        const res = await c.fetch(url, {
          method: "POST",
          headers,
          body: message.body,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throwForNtfyStatus(res, body);
        }

        const data = (await res.json().catch(() => null)) as { id?: string } | null;
        return data?.id ? { providerMessageId: data.id } : {};
      },

      testDelivery: async (ctx, args) => {
        const c = ctx as Ctx;
        const { channelConfig: cfg } = args as TestArgs;
        const headers: Record<string, string> = {};
        if (cfg.authHeader) headers["Authorization"] = cfg.authHeader;
        const res = await c.fetch(trimTrailingSlash(cfg.serverUrl), {
          method: "GET",
          headers,
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, message: `ntfy auth rejected (${res.status})` };
        }
        if (!res.ok) {
          return { ok: false, message: `ntfy ${res.status}` };
        }
        return { ok: true };
      },
    },
  },
});

export default ntfyPlugin;

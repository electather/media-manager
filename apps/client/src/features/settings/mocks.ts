// fallow-ignore-file code-duplication
// Mock data shared by the new settings pages.
//
// While the new design is being built out, these settings sub-pages render
// against in-memory state instead of the real auth + API calls. Pages keep
// their own local state copies so interactions feel real (toggles persist,
// rows disappear on revoke, etc.).

export interface MockUser {
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export const MOCK_USER: MockUser = {
  name: "Alex Rivers",
  email: "alex@example.com",
  emailVerified: false,
  createdAt: "2024-04-12T00:00:00.000Z",
};

export const MOCK_ROLE = {
  name: "Member",
} as const;

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface MockSession {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  updatedAt: string;
  current: boolean;
}

export const MOCK_SESSIONS: ReadonlyArray<MockSession> = [
  {
    id: "s-current",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ipAddress: "203.0.113.5",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    current: true,
  },
  {
    id: "s-iphone",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    ipAddress: "203.0.113.42",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    current: false,
  },
  {
    id: "s-windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    ipAddress: "198.51.100.7",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    current: false,
  },
];

// ─── Connections ─────────────────────────────────────────────────────────────

export type ConnectionStatus = "connected" | "expired" | "error" | "disconnected";
export type ConnectionAuthKind = "oauth" | "oauth_device" | "api_key" | "form";

export interface MockPlugin {
  id: string;
  name: string;
  description: string;
  authKind: ConnectionAuthKind;
  poolable: boolean;
  fields: ReadonlyArray<MockPluginField>;
}

export interface MockPluginField {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  kind: "text" | "password" | "secret" | "server-picker";
  required?: boolean;
}

export const MOCK_PLUGINS: ReadonlyArray<MockPlugin> = [
  {
    id: "plex",
    name: "Plex",
    description: "Stream from your Plex server library.",
    authKind: "oauth_device",
    poolable: true,
    fields: [
      { id: "label", label: "Label", placeholder: "Home server", kind: "text", required: true },
      { id: "server", label: "Server", kind: "server-picker", required: true },
      { id: "internalUrl", label: "Internal URL", kind: "text" },
    ],
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    description: "Connect a self-hosted Jellyfin instance.",
    authKind: "form",
    poolable: true,
    fields: [
      { id: "label", label: "Label", placeholder: "My Jellyfin", kind: "text", required: true },
      {
        id: "serverUrl",
        label: "Server URL",
        placeholder: "https://jellyfin.example.com",
        kind: "text",
        required: true,
      },
      { id: "apiKey", label: "API Key", kind: "password", required: true },
    ],
  },
  {
    id: "tmdb",
    name: "TMDB",
    description: "Movie and TV metadata from The Movie Database.",
    authKind: "api_key",
    poolable: false,
    fields: [
      {
        id: "apiKey",
        label: "API Key",
        kind: "secret",
        required: true,
        hint: "v4 read access token",
      },
    ],
  },
  {
    id: "tvdb",
    name: "TVDB",
    description: "TV series metadata from TheTVDB.",
    authKind: "api_key",
    poolable: false,
    fields: [{ id: "apiKey", label: "API Key", kind: "secret", required: true }],
  },
  {
    id: "trakt",
    name: "Trakt",
    description: "Sync your watchlist and history with Trakt.",
    authKind: "oauth",
    poolable: false,
    fields: [],
  },
];

export interface MockConnection {
  id: string;
  pluginId: string;
  label: string;
  sublabel?: string;
  status: ConnectionStatus;
  enabled: boolean;
  isDefault: boolean;
  lastVerifiedAt: string;
  tokenExpiresAt: string | null;
  errorMessage?: string;
}

export const MOCK_CONNECTIONS: ReadonlyArray<MockConnection> = [
  {
    id: "c-plex-home",
    pluginId: "plex",
    label: "Plex",
    sublabel: "Hyperion · 12 libraries",
    status: "connected",
    enabled: true,
    isDefault: true,
    lastVerifiedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  },
  {
    id: "c-tmdb",
    pluginId: "tmdb",
    label: "TMDB",
    status: "connected",
    enabled: true,
    isDefault: false,
    lastVerifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    tokenExpiresAt: null,
  },
  {
    id: "c-jellyfin-old",
    pluginId: "jellyfin",
    label: "Jellyfin",
    sublabel: "https://jellyfin.local",
    status: "expired",
    enabled: true,
    isDefault: false,
    lastVerifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    tokenExpiresAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: "c-trakt",
    pluginId: "trakt",
    label: "Trakt",
    status: "error",
    enabled: false,
    isDefault: false,
    lastVerifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    tokenExpiresAt: null,
    errorMessage: "401: refresh token rejected by upstream",
  },
];

// ─── Notification channels ───────────────────────────────────────────────────

export interface MockChannel {
  id: string;
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  name: string;
  locked?: boolean;
  config: ReadonlyArray<{ label: string; value: string }>;
}

export const MOCK_CATEGORIES = [
  { id: "media", requires: null },
  { id: "sync", requires: null },
  { id: "auth", requires: "admin" },
  { id: "system", requires: "admin" },
] as const;

export type CategoryId = (typeof MOCK_CATEGORIES)[number]["id"];

export const MOCK_CHANNELS: ReadonlyArray<MockChannel> = [
  {
    id: "ch-inbox",
    pluginId: "inbox",
    pluginName: "core",
    pluginVersion: "core",
    name: "Inbox",
    locked: true,
    config: [{ label: "in-app", value: "Always on" }],
  },
  {
    id: "ch-ntfy",
    pluginId: "ntfy",
    pluginName: "ntfy",
    pluginVersion: "1.4.2",
    name: "Phone push",
    config: [
      { label: "topic", value: "alex-nama-alerts" },
      { label: "server", value: "https://ntfy.sh" },
    ],
  },
  {
    id: "ch-discord",
    pluginId: "discord",
    pluginName: "discord-webhook",
    pluginVersion: "2.0.0",
    name: "#home-server",
    config: [{ label: "webhook", value: "https://discord.com/api/webhooks/…/eW9w" }],
  },
];

export const MOCK_AVAILABLE_CHANNEL_PLUGINS = [
  {
    pluginId: "ntfy",
    name: "ntfy",
    version: "1.4.2",
    description: "Self-hosted or hosted push topics.",
  },
  {
    pluginId: "telegram",
    name: "telegram",
    version: "0.9.1",
    description: "Direct messages via a bot.",
  },
  {
    pluginId: "discord",
    name: "discord-webhook",
    version: "2.0.0",
    description: "Post to a Discord channel via webhook URL.",
  },
  {
    pluginId: "webhook",
    name: "generic-webhook",
    version: "1.1.0",
    description: "Custom JSON POST to any HTTPS endpoint.",
  },
] as const;

export type ChannelSubscriptions = Record<string, Record<CategoryId, boolean>>;

export const DEFAULT_SUBSCRIPTIONS: ChannelSubscriptions = {
  "ch-inbox": { media: true, sync: true, auth: true, system: true },
  "ch-ntfy": { media: true, sync: true, auth: false, system: false },
  "ch-discord": { media: true, sync: false, auth: false, system: false },
};

// ─── Authorized apps ─────────────────────────────────────────────────────────

export interface MockAuthorizedApp {
  clientId: string;
  name: string;
  description: string;
  authorizedAt: string;
  lastSeenAt: string;
  scopes: ReadonlyArray<string>;
}

export const MOCK_AUTHORIZED_APPS: ReadonlyArray<MockAuthorizedApp> = [
  {
    clientId: "claude-desktop",
    name: "Claude Desktop",
    description: "Anthropic's official desktop client.",
    authorizedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    lastSeenAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    scopes: ["read", "write"],
  },
  {
    clientId: "raycast",
    name: "Raycast",
    description: "MCP integration for Raycast.",
    authorizedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    lastSeenAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    scopes: ["read"],
  },
];

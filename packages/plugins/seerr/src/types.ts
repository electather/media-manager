import type { PluginContext } from "@ent-mcp/plugin-sdk";

export interface SeerrCreds {
  sessionCookie: string;
  userId: number;
  password?: string;
}

export interface SeerrSharedCreds {}

export interface SeerrUserCfg {
  username: string;
  // Optional because, after the initial auth round-trip, password is promoted
  // out of the persisted userConfig into the encrypted credentials blob.
  // `startAuth` falls back to the prior credentials when the form omits it.
  password?: string;
}

export interface SeerrGlobalCfg {
  baseUrl: string;
}

export type Ctx = PluginContext<SeerrCreds, SeerrSharedCreds, SeerrUserCfg, SeerrGlobalCfg>;

export interface SeerrRequestRow {
  id: number;
  type: "movie" | "tv";
  status: number;
  createdAt: string;
  media: { tmdbId: number; title?: string; originalTitle?: string; posterPath?: string };
  seasons?: Array<{ seasonNumber: number }>;
  serverName?: string;
  profileName?: string;
}

import type { PluginContext } from "@ent-mcp/plugin-sdk";

export interface SeerrCreds {
  sessionCookie: string;
  userId: number;
}

export interface SeerrSharedCreds {}

export interface SeerrUserCfg {
  username: string;
  password: string;
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
}

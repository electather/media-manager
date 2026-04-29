import type { PluginContext } from "@ent-mcp/plugin-sdk";

export interface TraktCreds {
  accessToken: string;
  refreshToken: string;
  createdAt: number;
  expiresIn: number;
}

export interface TraktSharedCreds {
  clientId: string;
  clientSecret: string;
}

export type TraktUserCfg = Record<string, never>;
export type TraktGlobalCfg = Record<string, never>;

export type Ctx = PluginContext<TraktCreds, TraktSharedCreds, TraktUserCfg, TraktGlobalCfg>;

export interface TraktMovie {
  ids: { trakt: number; slug: string; imdb?: string; tmdb?: number };
  title: string;
  year: number | null;
  overview?: string;
}

export interface TraktShow {
  ids: { trakt: number; slug: string; imdb?: string; tmdb?: number; tvdb?: number };
  title: string;
  year: number | null;
  overview?: string;
}

export interface TraktMediaItemRef {
  type: "movie" | "tv";
  ids?: { trakt_id?: string };
}

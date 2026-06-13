import type { PluginContext } from "@nama/plugin-sdk";

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
  // Trakt occasionally serializes missing cross-service ids as JSON `null`
  // rather than omitting them — declare optionals as `T | null` so the
  // mapper can normalize to undefined before host validation.
  ids: {
    trakt: number;
    slug: string | null;
    imdb?: string | null;
    tmdb?: number | null;
  };
  title: string;
  year: number | null;
  overview?: string;
}

export interface TraktShow {
  ids: {
    trakt: number;
    slug: string | null;
    imdb?: string | null;
    tmdb?: number | null;
    tvdb?: number | null;
  };
  title: string;
  year: number | null;
  overview?: string;
}

export interface TraktMediaItemRef {
  type: "movie" | "tv";
  ids?: { trakt_id?: string };
}

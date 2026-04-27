import type { Ctx } from "../types";
import { tmdbGet } from "../client";
import { DEFAULT_REGION } from "../constants";

export const watchProviders = {
  async getProviders(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { id, type, region } = input as {
      id: string;
      type: "movie" | "tv";
      region?: string;
    };
    const data = (await tmdbGet(c, `/${type}/${id}/watch/providers`)) as {
      results?: Record<
        string,
        {
          flatrate?: Array<{ provider_name: string }>;
          rent?: Array<{ provider_name: string }>;
          buy?: Array<{ provider_name: string }>;
        }
      >;
    };
    // Capability contract documents "US" as the default region when none
    // is supplied by the caller.
    const pick = (data.results ?? {})[region ?? DEFAULT_REGION];
    return {
      streaming: (pick?.flatrate ?? []).map((p) => p.provider_name),
      rent: (pick?.rent ?? []).map((p) => p.provider_name),
      buy: (pick?.buy ?? []).map((p) => p.provider_name),
    };
  },
};

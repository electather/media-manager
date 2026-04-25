import { consola } from "consola";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { dispatchSingle } from "./dispatcher";
import { getIdBundle, upsertIdBundle, type IdBundle, type MediaType } from "./id-resolver";

type IdKind = "tmdb" | "tvdb" | "trakt" | "imdb";

function bundleHas(bundle: IdBundle, want: Array<keyof IdBundle>): boolean {
  return want.every((k) => Boolean(bundle[k]));
}

/**
 * Path-C gap-fill. Given a tmdb_id, ensures the target fields exist in id_map,
 * consulting `idResolve@v1` providers in registry order if needed. Non-throwing;
 * returns the best-effort bundle (may still be incomplete on upstream failure).
 */
export async function ensureIds(args: {
  userId: string;
  tmdbId: string;
  mediaType: MediaType;
  want: Array<keyof IdBundle>;
}): Promise<IdBundle> {
  const existing = (await getIdBundle(args.tmdbId, args.mediaType)) ?? {
    tmdb_id: args.tmdbId,
  };
  if (bundleHas(existing, args.want)) return existing;

  const providers = capabilityRegistry.listProviders("idResolve", "v1", "global");
  if (providers.length === 0) return existing;

  const installed = new Set(providers);
  const bundle: IdBundle = { ...existing };
  for (const pluginId of providers) {
    if (bundleHas(bundle, args.want)) break;
    try {
      const resolved = (await dispatchSingle<Record<IdKind, string | undefined>>({
        userId: args.userId,
        capability: "idResolve",
        version: "v1",
        method: "resolve",
        input: { from: "tmdb", id: args.tmdbId, type: args.mediaType },
        pluginId,
        skipCache: false,
      })) as Partial<Record<IdKind, string>> | null;
      if (!resolved) continue;
      if (resolved.imdb && !bundle.imdb_id) bundle.imdb_id = resolved.imdb;
      if (resolved.tvdb && !bundle.tvdb_id) bundle.tvdb_id = resolved.tvdb;
      if (resolved.trakt && !bundle.trakt_id) bundle.trakt_id = resolved.trakt;
    } catch (err) {
      consola.debug(`[gap-fill] ${pluginId} idResolve failed`, err);
    }
  }

  try {
    await upsertIdBundle(bundle, args.mediaType, {
      pluginId: "gap-fill",
      installedPlugins: installed,
    });
  } catch (err) {
    consola.debug("[gap-fill] upsertIdBundle failed", err);
  }
  return bundle;
}

import { registerBuiltin } from "../../plugin-runtime/loader";
import traktPlugin from "./trakt/plugin";
import tmdbPlugin from "./tmdb/plugin";
import tvdbPlugin from "./tvdb/plugin";
import seerrPlugin from "./seerr/plugin";
import jellyfinPlugin from "./jellyfin/plugin";

/**
 * Registers all built-in plugin modules with the loader. Called once during server boot
 * before PluginRuntime.bootstrapBuiltins runs.
 *
 * The `bytes` value is a synthetic identifier derived from the module itself — in v1 the
 * "source" of a built-in plugin is the compiled TypeScript, so we use a stable synthetic
 * string so the checksum is deterministic across restarts.
 */
export function registerBuiltinPlugins(): void {
  registerBuiltin({
    id: traktPlugin.manifest.id,
    module: traktPlugin,
    bytes: `builtin:${traktPlugin.manifest.id}@${traktPlugin.manifest.version}`,
  });
  registerBuiltin({
    id: tmdbPlugin.manifest.id,
    module: tmdbPlugin,
    bytes: `builtin:${tmdbPlugin.manifest.id}@${tmdbPlugin.manifest.version}`,
  });
  registerBuiltin({
    id: tvdbPlugin.manifest.id,
    module: tvdbPlugin,
    bytes: `builtin:${tvdbPlugin.manifest.id}@${tvdbPlugin.manifest.version}`,
  });
  registerBuiltin({
    id: seerrPlugin.manifest.id,
    module: seerrPlugin,
    bytes: `builtin:${seerrPlugin.manifest.id}@${seerrPlugin.manifest.version}`,
  });
  registerBuiltin({
    id: jellyfinPlugin.manifest.id,
    module: jellyfinPlugin,
    bytes: `builtin:${jellyfinPlugin.manifest.id}@${jellyfinPlugin.manifest.version}`,
  });
}

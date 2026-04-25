import { registerBuiltin } from "../../plugin-runtime/loader";
import traktPlugin from "./trakt/plugin";
import tmdbPlugin from "./tmdb/plugin";
import tvdbPlugin from "./tvdb/plugin";
import seerrPlugin from "./seerr/plugin";
import jellyfinPlugin from "./jellyfin/plugin";
import plexPlugin from "./plex/plugin";

const BUILTIN_PLUGINS = [
  traktPlugin,
  tmdbPlugin,
  tvdbPlugin,
  seerrPlugin,
  jellyfinPlugin,
  plexPlugin,
];

/**
 * Registers all built-in plugin modules with the loader. Called once during server boot
 * before PluginRuntime.bootstrapBuiltins runs.
 *
 * The `bytes` value is a synthetic identifier derived from the module itself — in v1 the
 * "source" of a built-in plugin is the compiled TypeScript, so we use a stable synthetic
 * string so the checksum is deterministic across restarts. Any manifest edit that should
 * reach users must bump `manifest.version`; `bootstrapBuiltins` only refreshes the DB row
 * when the checksum or version changes.
 */
export function registerBuiltinPlugins(): void {
  for (const module of BUILTIN_PLUGINS) {
    registerBuiltin({
      id: module.manifest.id,
      module,
      bytes: `builtin:${module.manifest.id}@${module.manifest.version}`,
    });
  }
}

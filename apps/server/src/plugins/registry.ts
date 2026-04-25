import { registerBuiltin } from "../plugin-runtime/loader";
import traktPlugin from "@ent-mcp/plugin-trakt";
import tmdbPlugin from "@ent-mcp/plugin-tmdb";
import tvdbPlugin from "@ent-mcp/plugin-tvdb";
import seerrPlugin from "@ent-mcp/plugin-seerr";
import jellyfinPlugin from "@ent-mcp/plugin-jellyfin";
import plexPlugin from "@ent-mcp/plugin-plex";

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
 * "source" of a built-in plugin is the workspace TypeScript imported here, so we use a
 * stable synthetic string so the checksum is deterministic across restarts. Any manifest
 * edit that should reach users must bump `manifest.version`; `bootstrapBuiltins` only
 * refreshes the DB row when the checksum or version changes.
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

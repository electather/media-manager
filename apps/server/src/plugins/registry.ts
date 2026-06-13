import { registerBuiltin } from "../plugin-runtime";
import traktPlugin from "@nama/plugin-trakt";
import tmdbPlugin from "@nama/plugin-tmdb";
import tvdbPlugin from "@nama/plugin-tvdb";
import fanartPlugin from "@nama/plugin-fanart";
import seerrPlugin from "@nama/plugin-seerr";
import jellyfinPlugin from "@nama/plugin-jellyfin";
import plexPlugin from "@nama/plugin-plex";
import inboxPlugin from "@nama/plugin-inbox";
import ntfyPlugin from "@nama/plugin-ntfy";
import telegramPlugin from "@nama/plugin-telegram";
import discordPlugin from "@nama/plugin-discord";

const BUILTIN_PLUGINS = [
  traktPlugin,
  tmdbPlugin,
  tvdbPlugin,
  fanartPlugin,
  seerrPlugin,
  jellyfinPlugin,
  plexPlugin,
  inboxPlugin,
  ntfyPlugin,
  telegramPlugin,
  discordPlugin,
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

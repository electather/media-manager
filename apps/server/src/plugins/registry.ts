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
 * Register all built-in plugins. Called once during boot before `bootstrapBuiltins`.
 * The `bytes` synthetic ID ensures deterministic checksum across restarts.
 * Manifest edits require `manifest.version` bump; DB row refreshes on checksum/version change.
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

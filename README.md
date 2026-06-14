# nama

> **Work in progress.** APIs and schemas may change between releases.

A self-hosted entertainment management platform with a built-in [MCP](https://modelcontextprotocol.io) server. Lets you and your AI agents discover, request, track, and rate movies and TV shows — all from a single dashboard or a natural-language conversation.

## Features

- **MCP server** (Streamable HTTP, OAuth 2.1) — expose your media library and request queue to any MCP-compatible AI client
- **React dashboard** — browse your watchlist, history, ratings, and pending requests
- **Plugin system** — fan-out to external services; each plugin declares the capabilities it provides
- **Self-hosted deploy** — Docker (SQLite, single binary)
- **Notifications** — inbox, Telegram, Discord, and ntfy delivery channels

## Built-in Plugins

| Plugin                             | Capabilities                                               |
| ---------------------------------- | ---------------------------------------------------------- |
| [Trakt](https://trakt.tv)          | Watch history, watchlist, ratings, recommendations         |
| [TMDB](https://www.themoviedb.org) | Metadata, artwork, search                                  |
| [TVDB](https://www.thetvdb.com)    | Series metadata, episode data                              |
| [Plex](https://www.plex.tv)        | Library availability, playback sessions, continue watching |
| [Jellyfin](https://jellyfin.org)   | Library availability, playback sessions                    |
| [Seerr](https://overseerr.dev)     | Media requests (Overseerr / Jellyseerr)                    |
| Telegram                           | Notification delivery                                      |
| Discord                            | Notification delivery                                      |
| ntfy                               | Notification delivery                                      |

## MCP Tools

Connect any MCP client (Claude Desktop, Cursor, etc.) to the server endpoint and use these tools:

- `ent_discover` — search, browse, and get preference-ranked recommendations
- `ent_details` — metadata and your personal state for a single title
- `ent_request` — submit a download request
- `ent_activity` — read and write watch history, watchlist, and ratings
- `ent_feedback` — record an explicit taste signal
- `ent_account` — list connected plugins and their capabilities

## Getting Started

### Docker (recommended)

```bash
curl -O https://raw.githubusercontent.com/electather/nama/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/electather/nama/main/.env.example
cp .env.example .env
# Fill in .env, then:
docker compose up -d
```

The dashboard is available at `http://localhost:3000`.

### From Source

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3 and the `vp` CLI (`bun add -g vite-plus`).

```bash
git clone https://github.com/electather/nama.git
cd nama
bun install
cp .env.example .env.dev
# Edit .env.dev with your API keys and secrets — this is the env file
# loaded for local development (git-ignored, never committed).
bun run db:migrate
bun run dev
```

Server: `http://localhost:3000` · Client: `http://localhost:5173`

> Local development reads `.env.dev`. Generate the auth and encryption
> secrets with `openssl rand -hex 32` and keep the file out of version
> control — it is already listed in `.gitignore`.

## Architecture

```
apps/
  server/         # Hono + MCP + Better Auth (Bun runtime)
  client/         # React 19 + TanStack Router + React Query
packages/
  shared/         # Isomorphic types, schemas, enums
  plugin-sdk/     # Plugin authoring SDK
  plugins/        # Built-in plugin implementations
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and pull requests are welcome.

## License

[MIT](LICENSE)

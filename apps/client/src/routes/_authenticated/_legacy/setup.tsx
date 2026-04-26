import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_legacy/setup")({
  component: SetupPage,
});

/**
 * Onboarding wizard shown once after first login. Sets has_onboarded on the
 * user and redirects to / on completion. This route should eventually use its
 * own full-screen layout (no sidebar) rather than the default app shell.
 */
function SetupPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Welcome</h1>
      <p className="text-muted-foreground">
        Multi-step onboarding wizard. Step 1: Welcome — explains the service and MCP client
        integration. Step 2: Connect Services — cards for Trakt (OAuth), Seerr (URL + API key),
        TMDB/TVDB (API key or server default), all optional. Step 3: Import History (if Trakt
        connected) — initial Trakt sync and optional Letterboxd CSV import with progress indicator.
        Step 4: Initial Preferences — pick 5 genres and 5 movies/shows to seed the recommendation
        profile. Step 5: MCP Setup Guide — shows the user's MCP endpoint URL and a copy-paste config
        snippet for Claude Desktop / Cursor.
      </p>
    </div>
  );
}

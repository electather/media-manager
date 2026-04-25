// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectionModal, type PluginSummary } from "../connection-modal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const formPluginBase: PluginSummary = {
  id: "plex",
  name: "Plex",
  version: "1.0.0",
  description: "Self-hosted media server.",
  authKind: "form",
  userScopedCapabilities: [
    { id: "watchHistory", version: "v1" },
    { id: "playback", version: "v1" },
  ],
  globalScopedCapabilities: [],
  userConfigSchema: {
    type: "object",
    required: ["externalUrl", "apiKey"],
    properties: {
      externalUrl: {
        type: "string",
        title: "External URL",
        format: "uri",
        "x-allowed-host": true,
      },
      apiKey: {
        type: "string",
        title: "API Key",
        "x-secret": true,
      },
    },
  },
  adminSharedAvailable: false,
};

const traktPlugin: PluginSummary = {
  id: "trakt",
  name: "Trakt",
  version: "1.0.0",
  description: "Watch history sync.",
  authKind: "oauth_device",
  userScopedCapabilities: [
    { id: "watchHistory", version: "v1" },
    { id: "watchlist", version: "v1" },
  ],
  globalScopedCapabilities: [{ id: "idResolve", version: "v1" }],
  userConfigSchema: null,
  adminSharedAvailable: true,
};

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

async function fillRequiredFields() {
  // FieldTitle in this codebase renders as a `<div>` rather than a `<label>`,
  // so role + name lookups don't work. Match against the placeholders that
  // schema-form sets for URI-typed and secret-typed inputs in create mode.
  await userEvent.type(
    screen.getByPlaceholderText("https://example.com"),
    "https://plex.example.com",
  );
  await userEvent.type(screen.getByPlaceholderText("••••••••••••••••"), "abc123");
}

describe("ConnectionModal — typed errors and scoped capabilities", () => {
  beforeEach(() => {
    // Default to a 200 OK so unrelated calls (display-name patches, etc.) don't
    // throw. Individual tests override for the specific endpoint they exercise.
    stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("renders user-scoped capability badges and an 'Also provides' line for global-scoped", () => {
    render(
      <ConnectionModal
        open
        plugin={traktPlugin}
        existing={null}
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />,
    );

    expect(screen.getByText("Watch History")).toBeTruthy();
    expect(screen.getByText("Watchlist")).toBeTruthy();
    // The visible text is "Also provides ID Resolution without a connection"
    // (preceded by an sr-only span carrying "Also available without a connection: ").
    expect(screen.getByText(/Also provides ID Resolution without a connection/i)).toBeTruthy();
  });

  it("does not render the 'Also provides' line when globalScopedCapabilities is empty", () => {
    render(
      <ConnectionModal
        open
        plugin={formPluginBase}
        existing={null}
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />,
    );

    expect(screen.queryByText(/available without a connection/i)).toBeNull();
  });

  it("rewrites plugin.credentials_empty into the spec'd copy with the schema title substituted", async () => {
    stubFetch(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/connections") || url.endsWith("/connections/")) {
        return new Response(
          JSON.stringify({
            code: "plugin.credentials_empty",
            devMessage: "apiKey is required",
            params: { field: "apiKey" },
          }),
          { status: 400 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    render(
      <ConnectionModal
        open
        plugin={formPluginBase}
        existing={null}
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />,
    );

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: /save connection/i }));

    await waitFor(() => {
      // Banner copy substitutes the schema's `title` ("API Key") into the
      // spec'd template, not the raw property name ("apiKey"). Article is
      // selected by leading-vowel-letter ("an" for "API Key").
      expect(
        screen.getAllByText("Credentials can't be blank. Enter an API Key to continue.").length,
      ).toBeGreaterThan(0);
    });
  });

  it("routes plugin.invalid_base_url to the URL input via the generic field mapping", async () => {
    stubFetch(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/connections") || url.endsWith("/connections/")) {
        return new Response(
          JSON.stringify({
            code: "plugin.invalid_base_url",
            devMessage: "External URL is not a valid URL",
            params: { field: "externalUrl", message: "External URL is not a valid URL" },
          }),
          { status: 400 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    render(
      <ConnectionModal
        open
        plugin={formPluginBase}
        existing={null}
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />,
    );

    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: /save connection/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/External URL is not a valid URL/i).length).toBeGreaterThan(0);
    });
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectionModal, type PluginSummary } from "../components/connection-modal";

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
  poolable: false,
  credentialsSchema: null,
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
  poolable: true,
  credentialsSchema: null,
  adminSharedAvailable: true,
};

const noAuthPlugin: PluginSummary = {
  id: "ntfy",
  name: "ntfy",
  version: "1.0.0",
  description: "Self-hosted push notifications.",
  authKind: "none",
  userScopedCapabilities: [{ id: "notificationDelivery", version: "v1" }],
  globalScopedCapabilities: [],
  userConfigSchema: {
    type: "object",
    required: ["serverUrl"],
    properties: {
      serverUrl: {
        type: "string",
        title: "ntfy server URL",
        format: "uri",
        // Mirrors the real ntfy manifest — the server validates this field
        // through `resolveAllowedHostsFromSchema` on the no-auth create path,
        // so the test schema carries the marker to keep the round-trip honest.
        "x-allowed-host": true,
      },
    },
  },
  poolable: false,
  credentialsSchema: null,
  adminSharedAvailable: false,
};

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

async function requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (typeof init?.body === "string") return JSON.parse(init.body) as unknown;
  if (input instanceof Request) {
    const text = await input.clone().text();
    return text ? (JSON.parse(text) as unknown) : null;
  }
  return null;
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

  it("renders the OAuth auth ceremony (not the edit-only form) in reconnect mode", () => {
    // Regression: Reconnect on a broken OAuth connection used to open the
    // display-name-only edit modal, leaving the user unable to re-authorise.
    // Reconnect mode must surface the create-style auth step instead.
    render(
      <ConnectionModal
        open
        plugin={traktPlugin}
        existing={null}
        reconnect
        onOpenChange={() => {}}
        onSuccess={() => {}}
      />,
    );

    // Title reflects the reconnect intent, not "Add" or "Edit".
    expect(screen.getByText(/Reconnect Trakt/i)).toBeTruthy();
    // The auth ceremony's primary action is present...
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeTruthy();
    // ...and the edit-only "Save changes" affordance is absent.
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    // The display-name field is hidden — reconnect never renames the row.
    expect(screen.queryByPlaceholderText("Trakt")).toBeNull();
  });

  it("posts auth-none schema values through the create connection path", async () => {
    const posts: unknown[] = [];
    stubFetch(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/connections") || url.endsWith("/connections/")) {
        posts.push(await requestJson(input, init));
        return new Response(JSON.stringify({ id: "conn-1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const onSuccess = vi.fn();

    render(
      <ConnectionModal
        open
        plugin={noAuthPlugin}
        existing={null}
        onOpenChange={() => {}}
        onSuccess={onSuccess}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("https://example.com"), "https://ntfy.sh");
    await userEvent.click(screen.getByRole("button", { name: /save connection/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(posts).toEqual([
      {
        pluginId: "ntfy",
        userConfig: { serverUrl: "https://ntfy.sh" },
      },
    ]);
  });
});

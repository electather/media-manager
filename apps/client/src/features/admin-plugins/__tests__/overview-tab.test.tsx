// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { OverviewTab } from "../detail/tabs/overview-tab";
import type { PluginRow } from "../shared/types";

afterEach(() => cleanup());

interface MakePluginOptions {
  scope?: "user" | "global" | "mixed";
  sharedCredentialsSchema?: Record<string, unknown>;
  isPureGlobal?: boolean;
  supportsPersonalKeyFallback?: boolean;
}

function makePlugin(options: MakePluginOptions = {}): PluginRow {
  const scope = options.scope ?? "user";
  const sharedCredentialsSchema =
    "sharedCredentialsSchema" in options ? options.sharedCredentialsSchema : { type: "object" };
  const isPureGlobal = options.isPureGlobal ?? false;
  const supportsPersonalKeyFallback =
    options.supportsPersonalKeyFallback ?? (Boolean(sharedCredentialsSchema) && scope !== "global");
  const capabilities =
    scope === "mixed"
      ? [
          { id: "metadata", version: "v1", scope: "global" },
          { id: "watchHistory", version: "v1", scope: "user" },
        ]
      : [{ id: "metadata", version: "v1", scope }];

  return {
    id: "trakt",
    version: "1.0.0",
    sourceType: "builtin",
    enabled: true,
    hasGlobalConfig: false,
    sharedCredentialsCount: sharedCredentialsSchema ? 1 : 0,
    sharedCredentialsEnabledCount: sharedCredentialsSchema ? 1 : 0,
    personalKeyFallback: "off",
    poolable: true,
    capabilities,
    manifest: {
      id: "trakt",
      name: "Trakt",
      version: "1.0.0",
      description: "",
      author: { name: "Test" },
      sdkVersion: "^1.0.0",
      allowedHosts: [],
      sharedCredentialsSchema,
      credentialsSchema: scope === "global" ? undefined : { type: "object" },
      auth: { kind: scope === "global" ? "none" : "form" },
      capabilities: Object.fromEntries(
        capabilities.map((capability) => [
          capability.id,
          { version: capability.version, scope: capability.scope },
        ]),
      ),
    },
    isPureGlobal,
    supportsPersonalKeyFallback,
    installedAt: 0,
    updatedAt: 0,
    isBuiltin: true,
    advanced: { adminAllowlist: null, adminHeaderNames: [] },
  } as PluginRow;
}

function renderOverview(plugin: PluginRow, onChangeFallback = vi.fn()) {
  render(
    <OverviewTab plugin={plugin} onChangeFallback={onChangeFallback} fallbackPending={false} />,
  );
  return onChangeFallback;
}

describe("OverviewTab personal-key fallback policy (V65)", () => {
  it("renders fallback choices when server marks the plugin eligible", async () => {
    const user = userEvent.setup();
    const onChangeFallback = renderOverview(makePlugin({ supportsPersonalKeyFallback: true }));

    expect(screen.getByText("Personal-key fallback policy")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /Admin first/ }));

    expect(onChangeFallback).toHaveBeenCalledWith(
      "admin-first" satisfies PersonalKeyFallbackPolicy,
    );
  });

  it("hides fallback choices when the server marks the plugin ineligible", () => {
    renderOverview(makePlugin({ supportsPersonalKeyFallback: false }));

    expect(screen.queryByText("Personal-key fallback policy")).toBeNull();
  });

  it("hides fallback choices for pure-global plugins regardless of capability list", () => {
    renderOverview(
      makePlugin({
        scope: "global",
        isPureGlobal: true,
        supportsPersonalKeyFallback: false,
      }),
    );

    expect(screen.queryByText("Personal-key fallback policy")).toBeNull();
  });
});

// @vitest-environment happy-dom
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicConfig } from "@nama/shared/users";

import { McpSetupStep } from "../components/steps/mcp-setup-step";
import { onboardingKeys } from "../lib/query-keys";

// The step reads the public config through a Suspense query, so we seed the
// cache rather than stub the fetcher — this exercises the real query path and
// the endpoint rendering the user actually sees.
function renderStep(config: PublicConfig) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(onboardingKeys.publicConfig(), config);
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <McpSetupStep />
      </Suspense>
    </QueryClientProvider>,
  );
}

const CONFIG: PublicConfig = {
  emailEnabled: false,
  needsBootstrap: false,
  mcpEndpointUrl: "https://nama.example/mcp",
  mcpScopes: ["read"],
};

afterEach(cleanup);

describe("McpSetupStep", () => {
  it("renders the MCP endpoint URL from public config", async () => {
    renderStep(CONFIG);
    expect(await screen.findByText("https://nama.example/mcp")).not.toBeNull();
  });

  it("opens the setup guide when the guide button is clicked", async () => {
    renderStep(CONFIG);
    const user = userEvent.setup();
    // The guide dialog is closed until the button is pressed.
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(await screen.findByRole("button", { name: /guide|setup/i }));
    expect(await screen.findByRole("dialog")).not.toBeNull();
  });
});

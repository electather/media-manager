// @vitest-environment happy-dom
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingState } from "@nama/shared/onboarding";

// The wizard composes a Suspense read of onboarding state with the complete
// mutation. We seed the read through the cache (real React Query, no internals
// poked) and stub only the leaf seams: the navigation/auth side effects and the
// step components, so the test isolates the Finish gate from step internals.
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useNavigate: () => navigateMock };
});

const auth = vi.hoisted(() => ({ getSession: vi.fn().mockResolvedValue({ data: null }) }));
vi.mock("@/shared/lib/auth", () => ({ authClient: auth }));

// Replace the step components with inert markers so the wizard render exercises
// the stepper and Finish gate without pulling in the connect-services Suspense
// boundary or the TMDB fetchers — those are not what this test asserts.
vi.mock("../lib/step-registry", () => ({
  ONBOARDING_STEP_REGISTRY: {
    welcome: { Component: () => <div data-testid="step-welcome" />, title: () => "Welcome" },
    "connect-services": {
      Component: () => <div data-testid="step-connect" />,
      title: () => "Connect services",
    },
  },
}));

// Spy on the complete-onboarding fetcher so a Finish click can be asserted to
// actually fire the mutation, without a real backend.
const completeOnboardingMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../lib/fetchers", async (orig) => ({
  ...((await orig()) as object),
  completeOnboarding: completeOnboardingMock,
}));

import { OnboardingWizard } from "../components/onboarding-wizard";
import { onboardingKeys } from "../lib/query-keys";

/** Renders the wizard with the onboarding-state query cache pre-seeded. */
function renderWizard(state: OnboardingState): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(onboardingKeys.state(), state);
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <OnboardingWizard />
      </Suspense>
    </QueryClientProvider>,
  );
  return client;
}

/** Builds onboarding state with the required connect-services step at a given completeness. */
function stateWithConnectComplete(complete: boolean): OnboardingState {
  return {
    hasOnboarded: false,
    steps: [
      { id: "welcome", title: "Welcome", applies: true, required: false, complete: true },
      {
        id: "connect-services",
        title: "Connect services",
        applies: true,
        required: true,
        complete,
      },
    ],
  };
}

function finishButton(): HTMLButtonElement {
  // The wizard opens on the first (welcome) step; the Finish button only renders
  // on the last step, so we advance with Next to reach the gate. Idle label is
  // "Finish setup" (the ICU `status=*` branch).
  return screen.getByRole("button", { name: /finish setup/i }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
});

describe("OnboardingWizard — Finish gate", () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it("disables Finish while a required, applicable step is incomplete", async () => {
    const user = userEvent.setup();
    renderWizard(stateWithConnectComplete(false));

    // Advance to the last step where Finish is shown.
    await user.click(screen.getByRole("button", { name: /next/i }));

    // Finish must be blocked: the required connect-services step is not complete,
    // so the app would not be functional if onboarding finished here.
    expect(finishButton().disabled).toBe(true);
  });

  it("enables Finish once every required, applicable step is complete", async () => {
    const user = userEvent.setup();
    renderWizard(stateWithConnectComplete(true));

    await user.click(screen.getByRole("button", { name: /next/i }));

    // With the only required step complete, Finish is allowed.
    expect(finishButton().disabled).toBe(false);
  });

  // A non-admin member is funneled to /setup by the route guard but the server
  // resolves zero applicable steps for them in v1. Rather than show an empty,
  // step-less wizard the user can't make sense of, the shell must render a brief
  // "all set" state whose single enabled Finish button completes onboarding.
  it("renders an all-set state with an enabled Finish when no step applies", async () => {
    renderWizard({
      hasOnboarded: false,
      steps: [
        // The only step does not apply (e.g. an admin-only step for a member),
        // so the wizard filters it out and has nothing to render.
        {
          id: "connect-services",
          title: "Connect services",
          applies: false,
          required: true,
          complete: false,
        },
      ],
    });

    // The wizard never reaches the stepper, so no Next button is shown — only
    // the Finish action, and it is enabled (nothing required is unmet).
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
    expect(finishButton().disabled).toBe(false);

    // The whole point of the all-set state: clicking Finish completes onboarding.
    completeOnboardingMock.mockClear();
    await userEvent.setup().click(finishButton());
    expect(completeOnboardingMock).toHaveBeenCalledTimes(1);
  });
});

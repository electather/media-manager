import type { ComponentType } from "react";
import { m } from "@/paraglide/messages";
import { ConnectServicesStep } from "../components/steps/connect-services-step";
import { McpSetupStep } from "../components/steps/mcp-setup-step";
import { WelcomeStep } from "../components/steps/welcome-step";

/** Maps server step ids to components+titles. Server owns which steps apply/require/complete; client only renders. New steps: add entry here + server descriptor. */
export const ONBOARDING_STEP_REGISTRY: Record<
  string,
  { Component: ComponentType; title: () => string }
> = {
  welcome: { Component: WelcomeStep, title: () => m.onboarding_step_welcome_title() },
  "connect-services": {
    Component: ConnectServicesStep,
    title: () => m.onboarding_step_connect_services_title(),
  },
  "mcp-setup": { Component: McpSetupStep, title: () => m.onboarding_step_mcp_setup_title() },
};

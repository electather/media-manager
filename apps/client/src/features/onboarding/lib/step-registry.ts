import type { ComponentType } from "react";
import { m } from "@/paraglide/messages";
import { ConnectServicesStep } from "../components/steps/connect-services-step";
import { McpSetupStep } from "../components/steps/mcp-setup-step";
import { WelcomeStep } from "../components/steps/welcome-step";

/**
 * Presentational map from a server step id to its component and localized
 * title. The authoritative descriptor list (which steps apply, are required,
 * or are complete) lives on the server; the client only decides how to render
 * each step it is told to show. Adding a future member-facing step means
 * appending an entry here plus a server descriptor — no shell changes.
 */
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

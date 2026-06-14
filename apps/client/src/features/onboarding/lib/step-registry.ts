import type { ComponentType } from "react";
import { ConnectServicesStep } from "../components/steps/connect-services-step";
import { WelcomeStep } from "../components/steps/welcome-step";

/**
 * Presentational map from a server step id to its component. The authoritative
 * descriptor list (which steps apply, are required, or are complete) lives on
 * the server; the client only decides how to render each step it is told to
 * show. Adding a future member-facing step means appending an entry here plus a
 * server descriptor — no shell changes.
 */
export const ONBOARDING_STEP_REGISTRY: Record<string, { Component: ComponentType }> = {
  welcome: { Component: WelcomeStep },
  "connect-services": { Component: ConnectServicesStep },
};

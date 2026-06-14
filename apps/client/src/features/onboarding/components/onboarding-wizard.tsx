import { Fragment, useState } from "react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperLabel,
  StepperSeparator,
} from "@/shared/ui/stepper";
import { useCompleteOnboarding } from "../hooks/use-complete-onboarding";
import type { CompleteOnboardingMutation } from "../hooks/use-complete-onboarding";
import { useOnboardingState } from "../hooks/use-onboarding-state";
import { ONBOARDING_STEP_REGISTRY } from "../lib/step-registry";

/** Localized titles for known steps, keyed by the server step id. */
const STEP_TITLES: Record<string, () => string> = {
  welcome: () => m.onboarding_step_welcome_title(),
  "connect-services": () => m.onboarding_step_connect_services_title(),
};

/**
 * Resolves a step's localized title, falling back to the server-supplied
 * (English) `title` when no client entry exists. In dev we warn so a new server
 * step shipped without a matching client title is caught instead of silently
 * rendering the untranslated fallback.
 */
function stepTitle(step: { id: string; title: string }): string {
  const localized = STEP_TITLES[step.id];
  if (!localized) {
    if (import.meta.env.DEV) {
      console.warn(
        `OnboardingWizard: no STEP_TITLES entry for step "${step.id}"; using server title.`,
      );
    }
    return step.title;
  }
  return localized();
}

/**
 * Full-screen onboarding wizard rendered after the admin's first sign-in. The
 * server resolves which steps apply, are required, and are complete; the wizard
 * renders only the applicable steps and gates Finish on the required ones.
 */
// Branches over server-resolved step state (applicable / required / complete);
// CRAP is coverage-estimated in CI and the flows are covered by onboarding-wizard.test.tsx.
// fallow-ignore-next-line complexity
export function OnboardingWizard() {
  const { data: state } = useOnboardingState();
  const complete = useCompleteOnboarding();
  const [activeIndex, setActiveIndex] = useState(0);

  const steps = state.steps.filter((step) => step.applies);
  const active = steps[activeIndex] ?? steps[0];
  const entry = active ? ONBOARDING_STEP_REGISTRY[active.id] : undefined;
  const StepComponent = entry?.Component;

  // The server resolves which steps apply per user. A non-admin member is
  // funneled here by the `_authenticated` guard (hasOnboarded === false) but has
  // zero applicable steps in v1, so render a brief "all set" state with a single
  // Finish button instead of an empty, step-less wizard.
  if (steps.length === 0) {
    return <NothingToConfigure complete={complete} />;
  }

  // Defense in depth: the server re-derives this gate on POST /complete, but
  // disabling Finish here keeps the UI honest while a required step is unmet.
  const requiredUnmet = steps.some((step) => step.required && !step.complete);
  const isLast = activeIndex >= steps.length - 1;

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {m.onboarding_wizard_title()}
          </h1>
          <p className="text-sm text-muted-foreground">{m.onboarding_wizard_subtitle()}</p>
        </header>

        <Card className="overflow-hidden p-0">
          <Stepper current={activeIndex} className="rounded-none">
            {steps.map((step, i) => (
              <Fragment key={step.id}>
                {i > 0 && <StepperSeparator />}
                <StepperItem index={i}>
                  <StepperIndicator />
                  <StepperLabel>{stepTitle(step)}</StepperLabel>
                </StepperItem>
              </Fragment>
            ))}
          </Stepper>
          <CardContent className="py-6">{StepComponent ? <StepComponent /> : null}</CardContent>
        </Card>

        <footer className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={activeIndex === 0 || complete.isPending}
            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          >
            {m.onboarding_wizard_back()}
          </Button>

          {isLast ? (
            <div className="flex flex-col items-end gap-1.5">
              <Button
                disabled={requiredUnmet || complete.isPending}
                onClick={() => complete.mutate()}
              >
                {m.onboarding_wizard_finish({ status: complete.isPending ? "pending" : "idle" })}
              </Button>
              {requiredUnmet && (
                <span className="text-xs text-muted-foreground">
                  {m.onboarding_wizard_finish_blocked()}
                </span>
              )}
              {complete.isError && (
                <span className="text-xs font-medium text-destructive">
                  {m.onboarding_wizard_complete_failed()}
                </span>
              )}
            </div>
          ) : (
            <Button
              disabled={complete.isPending}
              onClick={() => setActiveIndex((i) => Math.min(steps.length - 1, i + 1))}
            >
              {m.onboarding_wizard_next()}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * Shown when the server resolves zero applicable steps for the user (e.g. a
 * non-admin member in v1). There is nothing to configure, so the only action is
 * to mark onboarding complete via the same mutation the wizard uses.
 */
function NothingToConfigure({ complete }: { complete: CompleteOnboardingMutation }) {
  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {m.onboarding_wizard_nothing_title()}
          </h1>
          <p className="text-sm text-muted-foreground">{m.onboarding_wizard_nothing_body()}</p>
        </header>

        <footer className="flex items-center justify-end gap-3">
          <div className="flex flex-col items-end gap-1.5">
            <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
              {m.onboarding_wizard_finish({ status: complete.isPending ? "pending" : "idle" })}
            </Button>
            {complete.isError && (
              <span className="text-xs font-medium text-destructive">
                {m.onboarding_wizard_complete_failed()}
              </span>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

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
import { useOnboardingState } from "../hooks/use-onboarding-state";
import { ONBOARDING_STEP_REGISTRY } from "../lib/step-registry";

/** Localized titles for known steps, keyed by the server step id. */
const STEP_TITLES: Record<string, () => string> = {
  welcome: () => m.onboarding_step_welcome_title(),
  "connect-services": () => m.onboarding_step_connect_services_title(),
};

/**
 * Full-screen onboarding wizard rendered after the admin's first sign-in. The
 * server resolves which steps apply, are required, and are complete; the wizard
 * renders only the applicable steps and gates Finish on the required ones.
 */
export function OnboardingWizard() {
  const { data: state } = useOnboardingState();
  const complete = useCompleteOnboarding();
  const [activeIndex, setActiveIndex] = useState(0);

  const steps = state.steps.filter((step) => step.applies);
  const active = steps[activeIndex] ?? steps[0];
  const entry = active ? ONBOARDING_STEP_REGISTRY[active.id] : undefined;
  const StepComponent = entry?.Component;

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
                  <StepperLabel>{STEP_TITLES[step.id]?.() ?? step.title}</StepperLabel>
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

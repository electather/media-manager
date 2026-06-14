import { Hono } from "hono";
import type { OnboardingState, OnboardingStepState } from "@nama/shared/onboarding";
import {
  isUserOnboarded,
  loadUserRole,
  markUserOnboarded,
  requireSession,
  sessionUserId,
  type UserRoleInfo,
} from "../../auth";
import { sharedCredentialsService } from "../../plugin-runtime";
import { badRequest } from "../../diagnostics/http-errors";

/** Server-side context every step descriptor is evaluated against. The role
 *  drives which steps apply; `tmdbConfigured` drives completion of the
 *  required services step. Neither is available on the client session, so the
 *  registry and its predicates live here as the source of truth. */
interface OnboardingStepContext {
  role: UserRoleInfo | null;
  tmdbConfigured: boolean;
}

/** A single onboarding step. Predicates are pure functions of the context so
 *  the resolved wire shape can be unit-tested without HTTP. */
interface OnboardingStepDescriptor {
  id: string;
  title: string;
  appliesTo(ctx: OnboardingStepContext): boolean;
  isRequired(ctx: OnboardingStepContext): boolean;
  isComplete(ctx: OnboardingStepContext): boolean;
}

/**
 * v1 registry. Both steps apply only to system admins — the framework is
 * role-aware, but only the admin path is wired in v1. Adding a member-facing
 * step later is purely additive: append a descriptor whose `appliesTo` matches
 * the non-admin role plus a client component keyed by its `id`.
 */
export const STEPS: OnboardingStepDescriptor[] = [
  {
    id: "welcome",
    title: "Welcome",
    appliesTo: (ctx) => !!ctx.role?.isSystemAdmin,
    isRequired: () => false,
    isComplete: () => true,
  },
  {
    id: "connect-services",
    title: "Connect services",
    appliesTo: (ctx) => !!ctx.role?.isSystemAdmin,
    isRequired: () => true,
    isComplete: (ctx) => ctx.tmdbConfigured,
  },
];

/** Resolves the registry against `ctx` into the presentational wire objects the
 *  client renders. Pure so the suite can assert role filtering and completion
 *  without an HTTP round-trip. */
export function resolveOnboardingSteps(ctx: OnboardingStepContext): OnboardingStepState[] {
  return STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    applies: step.appliesTo(ctx),
    required: step.isRequired(ctx),
    complete: step.isComplete(ctx),
  }));
}

/** Builds the server-authoritative context for `userId`: the role decides which
 *  steps apply, and the enabled-TMDB count decides whether the required
 *  services step is satisfied. */
export async function buildOnboardingContext(userId: string): Promise<OnboardingStepContext> {
  const role = await loadUserRole(userId);
  const tmdbConfigured = (await sharedCredentialsService.countEnabled("tmdb")) > 0;
  return { role, tmdbConfigured };
}

/** True iff every step that both applies and is required is complete. This is
 *  the gate `POST /complete` re-derives server-side — the client is never
 *  trusted. */
export function requiredStepsSatisfied(steps: OnboardingStepState[]): boolean {
  return steps.every((step) => !(step.applies && step.required) || step.complete);
}

/**
 * Session-guarded onboarding endpoint mounted at `/api/onboarding`. Hosts the
 * server-side step registry and exposes the resolved, presentational step list
 * plus the authoritative completion flip.
 */
export const onboardingApp = new Hono()
  .use("*", requireSession)
  .get("/state", async (c) => {
    const userId = sessionUserId(c);
    // `requireSession` stores the Better Auth session untyped on the Hono
    // context, so `c.get("session").user.hasOnboarded` does not type-check on
    // this route context. We read the flag through the auth barrel instead —
    // the owning module reads its own column — which keeps this fully typed.
    const ctx = await buildOnboardingContext(userId);
    const body: OnboardingState = {
      hasOnboarded: await isUserOnboarded(userId),
      steps: resolveOnboardingSteps(ctx),
    };
    return c.json(body);
  })
  .post("/complete", async (c) => {
    const userId = sessionUserId(c);
    const ctx = await buildOnboardingContext(userId);
    if (!requiredStepsSatisfied(resolveOnboardingSteps(ctx))) {
      throw badRequest("onboarding.requirements_unmet", "Complete the required steps first");
    }
    await markUserOnboarded(userId);
    return c.json({ ok: true });
  });

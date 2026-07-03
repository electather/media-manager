import { consola } from "consola";
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
import { CATALOG_DISCOVER_SNAPSHOT_JOB_ID } from "../../catalog";
import { currentRequestContext } from "../../diagnostics/request-context";
import { sharedCredentialsService } from "../../plugin-runtime";
import { badRequest } from "../../diagnostics/http-errors";
import * as jobs from "../../jobs";

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

// v1 registry: both steps apply only to system admins (framework is role-aware
// but only admin path wired). Member-facing steps are purely additive: add a
// descriptor with appliesTo + client component. v2: mcp-setup step deferred (#579).
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
  {
    id: "mcp-setup",
    title: "Connect an AI client",
    appliesTo: (ctx) => !!ctx.role?.isSystemAdmin,
    isRequired: () => false,
    isComplete: () => true,
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

// Triggers discover-snapshot warmly after first-install so feed populates
// within seconds (vs waiting for 06:00 UTC run). Fire-and-forget: failure must
// never block onboarding. Exported as seam for unit test assertion.
export function warmDiscoverCatalog(userId: string, requestId?: string): void {
  const entry = jobs.find(CATALOG_DISCOVER_SNAPSHOT_JOB_ID);
  if (!entry?.triggerFromApi) return;
  void entry
    .triggerFromApi(null, { triggeredBy: "user", triggeredByUserId: userId, requestId })
    .catch((err) => consola.warn("[onboarding] discover-snapshot warm failed to start", err));
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
    // Check before marking so warmDiscoverCatalog only fires on first completion.
    // Repeat calls are idempotent: markUserOnboarded is a no-op if already set.
    const alreadyOnboarded = await isUserOnboarded(userId);
    const ctx = await buildOnboardingContext(userId);
    if (!requiredStepsSatisfied(resolveOnboardingSteps(ctx))) {
      throw badRequest("onboarding.requirements_unmet", "Complete the required steps first");
    }
    await markUserOnboarded(userId);
    if (!alreadyOnboarded) {
      // Warm the discover catalog so the home feed populates without waiting
      // for the next scheduled snapshot run.
      warmDiscoverCatalog(userId, currentRequestContext()?.requestId);
    }
    return c.json({ ok: true });
  });

import { registerHomeLayoutWarm } from "./layout-warm";

/**
 * Registers the single home job (`host.home.layout_warm`). Invoked from
 * `apps/server/src/index.ts` in fixed alphabetical module order so handler
 * fan-out timing stays deterministic — boot.test.ts enforces this.
 *
 * Cloudflare Workers (`apps/server/src/worker.ts`) does NOT call this — the
 * underlying registration is croner-backed and the Workers runtime has no
 * persistent process to host the schedule. The triggerable handle is also
 * scheduler-coupled, so there is no carve-out to expose here; if a Worker
 * ever needs to recompute a single user's layout it should go through the
 * service surface directly.
 */
export function registerJobs(): void {
  registerHomeLayoutWarm();
}

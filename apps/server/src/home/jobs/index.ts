import { registerHomeLayoutWarm } from "./layout-warm";

/**
 * Registers the single home job (`host.home.layout_warm`). Invoked from
 * `apps/server/src/index.ts` in fixed alphabetical module order so handler
 * fan-out timing stays deterministic — boot.test.ts enforces this.
 */
export function registerJobs(): void {
  registerHomeLayoutWarm();
}

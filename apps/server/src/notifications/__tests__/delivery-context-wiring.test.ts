import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

// Regression: PR 7 used buildContext({allowedHosts: []}) → silent rejection. Fix: route via pluginRuntime.buildJobContext (threads manifest + dynamic + admin allowlists).
const here = dirname(fileURLToPath(import.meta.url));
// The plugin-context wiring lives in the delivery handler helper now (split
// out so jobs/delivery.ts stays under the 200 LOC cap); this guard pins the
// invariant on the file that actually does the wiring.
const deliverHandlerSource = readFileSync(resolve(here, "../internal/deliver-handler.ts"), "utf-8");

describe("delivery-job: context wiring", () => {
  it("uses pluginRuntime.buildJobContext to build per-delivery contexts", () => {
    expect(deliverHandlerSource).toContain("pluginRuntime.buildJobContext(");
  });

  it("does not pass an empty allowedHosts list to buildContext (regression)", () => {
    expect(deliverHandlerSource).not.toContain("allowedHosts: []");
  });

  it("does not import the raw buildContext helper", () => {
    // buildJobContext is the right entry point; importing buildContext
    // directly is what introduced the empty-allowlist bug. Block the
    // import path so a future refactor cannot silently re-introduce it.
    expect(deliverHandlerSource).not.toMatch(
      /import\s*\{[^}]*\bbuildContext\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/plugin-runtime\/context["']/,
    );
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const watchlistRoot = join(import.meta.dirname, "..");

describe("watchlist architecture", () => {
  it("keeps the watchlist service split behind a directory entry point", () => {
    expect(existsSync(join(watchlistRoot, "service.ts"))).toBe(false);
    expect(existsSync(join(watchlistRoot, "service", "index.ts"))).toBe(true);
  });

  it("keeps service modules on media primitives instead of local row helpers", () => {
    const serviceFiles = [
      "counts.ts",
      "index.ts",
      "items.ts",
      "mutations.ts",
      "sections.ts",
      "seed.ts",
    ];
    const forbiddenImports = [
      "../repo",
      "./repo",
      "../classify",
      "./classify",
      "../enrich",
      "./enrich",
      "../availability-cache",
      "./availability-cache",
    ];

    for (const file of serviceFiles) {
      const source = readFileSync(join(watchlistRoot, "service", file), "utf8");
      for (const specifier of forbiddenImports) {
        expect(source).not.toContain(`from "${specifier}"`);
      }
    }
  });
});

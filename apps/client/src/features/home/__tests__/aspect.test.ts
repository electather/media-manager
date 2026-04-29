import { describe, expect, it } from "vite-plus/test";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

import { deriveAspect, deriveTreatment } from "../lib/aspect";

const baseItem: CompactMediaItem = {
  id: "movie:1",
  tmdbId: "1",
  mediaType: "movie",
  title: "Test",
};

describe("deriveTreatment", () => {
  it("returns continue-watching when progress is set", () => {
    expect(deriveTreatment({ ...baseItem, progress: { watched: 30, total: 100 } })).toBe(
      "continue-watching",
    );
  });

  it("returns upcoming when only episode is set", () => {
    expect(
      deriveTreatment({
        ...baseItem,
        episode: { season: 1, episode: 2, airsAt: Date.now() + 86_400_000 },
      }),
    ).toBe("upcoming");
  });

  it("returns default otherwise", () => {
    expect(deriveTreatment(baseItem)).toBe("default");
  });
});

describe("deriveAspect", () => {
  it("returns 16/9 when progress is present", () => {
    expect(deriveAspect({ ...baseItem, progress: { watched: 1, total: 2 } })).toBe("16/9");
  });

  it("returns 16/9 when isHero is true", () => {
    expect(deriveAspect(baseItem, { isHero: true })).toBe("16/9");
  });

  it("returns 16/9 when isThumb is true", () => {
    expect(deriveAspect(baseItem, { isThumb: true })).toBe("16/9");
  });

  it("returns 2/3 by default", () => {
    expect(deriveAspect(baseItem)).toBe("2/3");
  });
});

import { describe, expect, it } from "vite-plus/test";
import * as m from "@/paraglide/messages";

// US-011 (#512): home card-kind, match-reason, and error-fallback label
// families were consolidated into keyed ICU variants. Each variant must render
// the exact string the per-key message it replaced rendered (no copy change).

describe("US-011 home ICU variants — copy parity", () => {
  // The card-kind variant since moved to the shared `media` namespace
  // (`media_kind`), reused by every media surface; copy must stay unchanged.
  it("renders the card-kind variant (selector `kind`) unchanged", () => {
    expect(m.media_kind({ kind: "movie" }, { locale: "en" })).toBe("Movie");
    expect(m.media_kind({ kind: "tv" }, { locale: "en" })).toBe("TV series");
  });

  it("renders match-reason copy (selector `reason`) with interpolation unchanged", () => {
    expect(
      m.home_match_reason(
        { reason: "matches_recent_picks", n: "2", genre: "", seedTitle: "" },
        { locale: "en" },
      ),
    ).toBe("Matches 2 recent picks.");
    expect(
      m.home_match_reason(
        { reason: "from_genre_you_love", n: "", genre: "Drama", seedTitle: "" },
        { locale: "en" },
      ),
    ).toBe("From Drama you love.");
    expect(
      m.home_match_reason(
        { reason: "similar_to_seed", n: "", genre: "", seedTitle: "Dune" },
        { locale: "en" },
      ),
    ).toBe("Similar to Dune.");
    expect(
      m.home_match_reason(
        { reason: "finishing_soon", n: "", genre: "", seedTitle: "" },
        { locale: "en" },
      ),
    ).toBe("Almost finished.");
  });

  it("renders error title / body variants (selector `variant`) unchanged", () => {
    expect(m.home_error_title({ variant: "auth" }, { locale: "en" })).toBe("Your session expired");
    expect(m.home_error_title({ variant: "unknown" }, { locale: "en" })).toBe(
      "Couldn't load the home feed",
    );
    expect(m.home_error_body({ variant: "offline" }, { locale: "en" })).toBe(
      "Check your connection and try again — your data is safe.",
    );
  });
});

import { describe, it, expect } from "vite-plus/test";
import { capabilityDisplay, capabilityListSummary } from "../capabilities";

describe("capabilityDisplay", () => {
  it("returns the mapped label and icon for known capability ids", () => {
    expect(capabilityDisplay("watchHistory").label).toBe("Watch History");
    expect(capabilityDisplay("idResolve").label).toBe("ID Resolution");
    expect(capabilityDisplay("libraryAvailability").label).toBe("Library Availability");
  });

  it("falls back to a titleized label and the generic icon for unmapped ids", () => {
    expect(capabilityDisplay("brand_new_thing").label).toBe("Brand New Thing");
    expect(capabilityDisplay("snake_case_id").label).toBe("Snake Case Id");
    expect(capabilityDisplay("camelCaseId").label).toBe("Camel Case Id");
    // The fallback uses a generic icon — verify the mapped vs fallback paths
    // produce different icons for a known and unknown id respectively.
    expect(capabilityDisplay("watchHistory").icon).not.toBe(
      capabilityDisplay("totally_unknown").icon,
    );
  });
});

describe("capabilityListSummary", () => {
  it("returns the empty string when no entries are passed", () => {
    expect(capabilityListSummary([])).toBe("");
  });

  it("joins all labels with a comma when the list fits in `max`", () => {
    expect(
      capabilityListSummary([
        { id: "watchHistory", version: "v1" },
        { id: "watchlist", version: "v1" },
      ]),
    ).toBe("Watch History, Watchlist");
  });

  it("truncates with a `+N more` tail when over `max`", () => {
    expect(
      capabilityListSummary(
        [
          { id: "watchHistory", version: "v1" },
          { id: "watchlist", version: "v1" },
          { id: "ratings", version: "v1" },
          { id: "calendar", version: "v1" },
          { id: "recommendations", version: "v1" },
        ],
        3,
      ),
    ).toBe("Watch History, Watchlist, Ratings +2 more");
  });

  it("respects a custom `max` cap", () => {
    expect(
      capabilityListSummary(
        [
          { id: "watchHistory", version: "v1" },
          { id: "watchlist", version: "v1" },
          { id: "ratings", version: "v1" },
        ],
        1,
      ),
    ).toBe("Watch History +2 more");
  });

  it("does not truncate when the list length equals `max` exactly", () => {
    expect(
      capabilityListSummary(
        [
          { id: "watchHistory", version: "v1" },
          { id: "watchlist", version: "v1" },
          { id: "ratings", version: "v1" },
        ],
        3,
      ),
    ).toBe("Watch History, Watchlist, Ratings");
  });
});

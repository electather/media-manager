import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import * as m from "@/paraglide/messages";

// US-011 (#511/#512): the watchlist + home label families were consolidated
// into keyed ICU variants. These tests pin the two acceptance bars:
//   1. No user-visible copy change — each variant renders the exact string the
//      per-key message it replaced rendered (representative set).
//   2. The watchlist + home message surface drops >= 30% versus before.

function readMessages(rel: string): Record<string, unknown> {
  const url = new URL(`../../../../messages/${rel}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Record<string, unknown>;
}

describe("US-011 watchlist ICU variants — copy parity", () => {
  it("renders bucket / sort / section / mood / source labels unchanged", () => {
    // Bucket filter chips (selector `bucket`, incl. the hyphenated `in-progress`).
    expect(m.watchlist_bucket_label({ bucket: "all" }, { locale: "en" })).toBe("All");
    expect(m.watchlist_bucket_label({ bucket: "ready" }, { locale: "en" })).toBe("Ready");
    expect(m.watchlist_bucket_label({ bucket: "in-progress" }, { locale: "en" })).toBe(
      "In progress",
    );
    expect(m.watchlist_bucket_label({ bucket: "unavailable" }, { locale: "en" })).toBe(
      "Unavailable",
    );

    // Sort options (selector `sortKey`).
    expect(m.watchlist_sort({ sortKey: "recent" }, { locale: "en" })).toBe("Recently added");
    expect(m.watchlist_sort({ sortKey: "alpha" }, { locale: "en" })).toBe("A → Z");

    // Section eyebrow / title (selector `section`).
    expect(m.watchlist_section_title({ section: "tonight" }, { locale: "en" })).toBe("Tonight");
    expect(m.watchlist_section_eyebrow({ section: "recent" }, { locale: "en" })).toBe(
      "Audit trail",
    );
    expect(m.watchlist_section_title({ section: "coming_up" }, { locale: "en" })).toBe("Coming up");

    // Mood label + note (selector `moodId`).
    expect(m.watchlist_mood_label({ moodId: "cozy" }, { locale: "en" })).toBe("Cozy night in");
    expect(m.watchlist_mood_note({ moodId: "binge" }, { locale: "en" })).toBe(
      "TV ready to marathon.",
    );
  });

  it("renders empty-state / source / chip / relative-time copy unchanged", () => {
    expect(m.watchlist_empty_title({ bucket: "ready" }, { locale: "en" })).toBe("Nothing ready");
    expect(m.watchlist_empty_body({ bucket: "upcoming" }, { locale: "en" })).toBe(
      "Future releases on your watchlist show up here.",
    );
    expect(m.watchlist_source({ source: "manual" }, { locale: "en" })).toBe("Added manually");
    expect(m.watchlist_recent_source({ source: "friend" }, { locale: "en" })).toBe("Friend's list");
    expect(m.watchlist_count({ bucket: "ready", n: "3" }, { locale: "en" })).toBe("3 ready");
    // Relative-time variant interpolates `{n}` for the count branches.
    expect(m.watchlist_recent_time({ unit: "just_now", n: "" }, { locale: "en" })).toBe("Just now");
    expect(m.watchlist_recent_time({ unit: "minutes_ago", n: "5" }, { locale: "en" })).toBe(
      "5 min ago",
    );
    expect(m.watchlist_recent_time({ unit: "days_ago", n: "2" }, { locale: "en" })).toBe(
      "2 days ago",
    );
  });
});

describe("US-011 message-count drop on the watchlist + home surface", () => {
  // Baseline captured before the ICU consolidation: 123 watchlist_* keys +
  // 137 home_* keys = 260 label-surface messages. (media_detail_* / request_*
  // co-located in home/en.json belong to other features and are excluded.)
  const SURFACE_BASELINE = 260;

  it("drops the watchlist + home label surface by at least 30%", () => {
    const watchlist = Object.keys(readMessages("watchlist/en.json")).filter((k) => k !== "$schema");
    const home = Object.keys(readMessages("home/en.json")).filter((k) => k.startsWith("home_"));
    const surface = watchlist.length + home.length;

    const drop = (SURFACE_BASELINE - surface) / SURFACE_BASELINE;
    expect(drop).toBeGreaterThanOrEqual(0.3);
    // Equivalent absolute bound, documenting the post-consolidation target.
    expect(surface).toBeLessThanOrEqual(Math.floor(SURFACE_BASELINE * 0.7));
  });

  it("keeps en and fa catalogs structurally aligned", () => {
    for (const file of ["watchlist", "home"]) {
      const en = Object.keys(readMessages(`${file}/en.json`)).sort();
      const fa = Object.keys(readMessages(`${file}/fa.json`)).sort();
      expect(fa).toEqual(en);
    }
  });
});

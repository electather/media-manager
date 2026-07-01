import { describe, expect, it } from "vite-plus/test";
import { NAME_MAX_LENGTH, truncateName } from "../index";

// U+1F600 GRINNING FACE — a non-BMP code point encoded as a surrogate pair,
// so each emoji counts as 2 UTF-16 code units toward NAME_MAX_LENGTH.
const EMOJI = "\u{1F600}";

describe("truncateName", () => {
  // WHY: the Zod guard measures String.length (UTF-16 units); truncation must use
  // the same yardstick or the hook would write a value the API layer would reject.
  it("returns names at or below the limit unchanged", () => {
    const name = "a".repeat(NAME_MAX_LENGTH);
    expect(truncateName(name)).toBe(name);
  });

  it("caps BMP-only names to exactly NAME_MAX_LENGTH code units", () => {
    const result = truncateName("a".repeat(NAME_MAX_LENGTH + 50));
    expect(result.length).toBe(NAME_MAX_LENGTH);
  });

  // WHY: the core bug (#830). Slicing at NAME_MAX_LENGTH when that index sits inside
  // a surrogate pair leaves a lone high surrogate; truncateName must drop it instead,
  // yielding NAME_MAX_LENGTH - 1 units and a string with no unpaired surrogate.
  it("never leaves a lone surrogate when the boundary lands mid-pair", () => {
    // (NAME_MAX_LENGTH / 2) emojis + one 'a' shifts every pair so the split at
    // index NAME_MAX_LENGTH falls between a high and low surrogate.
    const name = "a" + EMOJI.repeat(NAME_MAX_LENGTH);
    const result = truncateName(name);
    expect(result.length).toBe(NAME_MAX_LENGTH - 1);
    // A lone surrogate makes isWellFormed() false; a clean cut keeps it true.
    expect(result.isWellFormed()).toBe(true);
  });

  // WHY: when the boundary lands cleanly between whole code points the full
  // NAME_MAX_LENGTH budget is used — the surrogate check must not over-trim.
  it("keeps the full budget when the boundary lands between whole pairs", () => {
    const name = EMOJI.repeat(NAME_MAX_LENGTH);
    const result = truncateName(name);
    expect(result.length).toBe(NAME_MAX_LENGTH);
    expect(result.isWellFormed()).toBe(true);
  });

  // WHY: when the boundary index is a low surrogate the pair is already
  // complete inside the slice; back-off must NOT trigger.
  it("does not over-trim when the boundary index is a low surrogate", () => {
    // 50 emojis (100 UTF-16 units) fill indices 0–99, so index NAME_MAX_LENGTH-1 is always a low surrogate.
    const name = EMOJI.repeat(NAME_MAX_LENGTH / 2) + EMOJI.repeat(NAME_MAX_LENGTH);
    const result = truncateName(name);
    expect(result.length).toBe(NAME_MAX_LENGTH);
    expect(result.isWellFormed()).toBe(true);
  });
});

import { describe, it, expect } from "vite-plus/test";
import { classifySentiment, extractNoteKeywords } from "../sentiment";

describe("classifySentiment", () => {
  it("classifies clearly positive notes", () => {
    expect(classifySentiment("Loved this, absolutely fantastic")).toBe("positive");
  });
  it("classifies clearly negative notes", () => {
    expect(classifySentiment("Boring and predictable")).toBe("negative");
  });
  it("handles negation", () => {
    expect(classifySentiment("Not good at all")).toBe("negative");
    expect(classifySentiment("Not boring, really engaging")).toBe("positive");
  });
  it("falls back to neutral on unrecognized text", () => {
    expect(classifySentiment("It exists and is a movie")).toBe("neutral");
  });
});

describe("extractNoteKeywords", () => {
  it("matches item keywords that appear in the note", () => {
    const note = "Loved the unreliable narrator angle";
    const out = extractNoteKeywords(note, ["Unreliable Narrator", "Time Loop"]);
    expect(out).toEqual(["unreliable narrator"]);
  });
  it("returns empty when no keywords match", () => {
    expect(extractNoteKeywords("a b c", ["spaceship"])).toEqual([]);
  });
});

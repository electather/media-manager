import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { consola } from "consola";

const insertFeedbackMock = vi.fn();

// `feedback-log` imports the repo barrel via `../repo`; mock the same target so
// `record` exercises the real note-processing path without a database.
vi.mock("../repo", () => ({
  insertFeedback: (row: unknown) => insertFeedbackMock(row),
}));

const { feedbackLog } = await import("../internal/feedback-log");

describe("feedbackLog.record note handling", () => {
  beforeEach(() => {
    insertFeedbackMock.mockReset();
  });

  it("persists the full note even when it exceeds the classification bound", async () => {
    // The cap exists only to bound O(n) sentiment/keyword work; the user's
    // authored note must survive intact, so the persisted row keeps every byte.
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    const note = "a".repeat(5000); // > NOTE_CLASSIFY_MAX_CHARS (4096).

    const result = await feedbackLog.record({
      userId: "u1",
      tmdbId: "603",
      mediaType: "movie",
      action: "note",
      note,
    });

    const persisted = insertFeedbackMock.mock.calls[0]?.[0] as { note: string | null };
    expect(persisted.note).toBe(note);
    expect(persisted.note?.length).toBe(5000);
    expect(result.note).toBe(note);
    expect(
      warn.mock.calls.some(([msg]) => String(msg).includes("note classification input bounded")),
    ).toBe(true);

    warn.mockRestore();
  });

  it("does not warn or clip notes within the classification bound", async () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    const note = "Loved this, absolutely fantastic";

    const result = await feedbackLog.record({
      userId: "u1",
      tmdbId: "603",
      mediaType: "movie",
      action: "note",
      note,
    });

    expect(result.note).toBe(note);
    expect(
      warn.mock.calls.some(([msg]) => String(msg).includes("note classification input bounded")),
    ).toBe(false);

    warn.mockRestore();
  });
});

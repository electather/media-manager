import type { FeedbackSignals } from "./types";

/** Extracts preference signals from a free-text feedback note. */
export function extractSignals(_note: string): FeedbackSignals {
  // TODO: implement NLP-based signal extraction.
  return {
    genres: [],
    keywords: [],
    directors: [],
    actors: [],
    themes: [],
  };
}

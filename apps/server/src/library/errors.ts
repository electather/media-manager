/** Base error class for library-module failures. Carries a structured code. */
export class LibraryError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "LibraryError";
  }
}

/**
 * Raised when the owned-collection membership sync fails irrecoverably (a
 * terminal all-providers failure surfaced by `collection@v1`). An expected
 * plugin absence (no provider installed) is NOT an error — the service
 * swallows it at its boundary and returns zero counts, so this is reserved for
 * genuine failures the caller should classify as a failed run.
 */
export class LibrarySyncError extends LibraryError {
  constructor(message = "library membership sync failed") {
    super(message, "library.sync_failed");
    this.name = "LibrarySyncError";
  }
}

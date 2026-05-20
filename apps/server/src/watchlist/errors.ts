/** Base error class for watchlist-module failures. */
export class WatchlistError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "WatchlistError";
  }
}

/** Reserved for callers that need to distinguish "row missing" from other errors. */
export class WatchlistNotFoundError extends WatchlistError {
  constructor(message = "watchlist row not found") {
    super(message, "watchlist.not_found");
    this.name = "WatchlistNotFoundError";
  }
}

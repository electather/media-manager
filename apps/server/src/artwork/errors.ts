/** Base error class for artwork service failures. */
export class ArtworkServiceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ArtworkServiceError";
  }
}

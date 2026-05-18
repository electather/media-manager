/** Base error class for home composition failures. */
export class HomeServiceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "HomeServiceError";
  }
}

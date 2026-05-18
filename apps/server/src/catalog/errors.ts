export class CatalogServiceError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "CatalogServiceError";
    this.code = code;
  }
}

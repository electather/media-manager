/** Base error class for preference-engine failures. */
export class PreferencesError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "PreferencesError";
  }
}

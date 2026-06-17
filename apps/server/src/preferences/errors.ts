// fallow-ignore-file code-duplication
// Per-module typed-error classes intentionally share the same base-class shape across modules (library, notifications, watchlist); each module owns its own errors.

/** Base error class for preference-engine failures. */
export class PreferencesError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "PreferencesError";
  }
}

/** Thrown when a required job is not yet registered with the jobs registry. */
export class JobNotRegisteredError extends PreferencesError {
  constructor(jobId: string) {
    super(`job ${jobId} is not registered`, "preferences.job_not_registered");
    this.name = "JobNotRegisteredError";
  }
}

/** Thrown when a registered job cannot be triggered from the API (wrong kind or missing handler). */
export class JobNotTriggerableError extends PreferencesError {
  constructor(jobId: string) {
    super(`job ${jobId} is not triggerable`, "preferences.job_not_triggerable");
    this.name = "JobNotTriggerableError";
  }
}

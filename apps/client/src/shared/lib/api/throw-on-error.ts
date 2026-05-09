import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { safeJson } from "@/shared/lib/diagnostics/safe-json";

/** Constructor signature for feature-level typed API error classes. Each
 *  feature defines a class that takes the HTTP status and parsed error body
 *  envelope, so a generic helper can build and throw the right subclass. */
export type ApiErrorCtor = new (status: number, body: ApiErrorBody | null) => Error;

/**
 * Reads the error envelope from a non-OK Response and throws the supplied
 * typed error class. Centralised so each feature's fetcher module no longer
 * carries a local copy of this same idiom.
 */
export async function throwOnApiError(res: Response, ErrorCtor: ApiErrorCtor): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new ErrorCtor(res.status, body);
}

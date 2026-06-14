import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/** Typed error for the auth feature's public reads (e.g. trending posters). */
export class AuthApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AuthApiError", status, body, `auth request failed (${status})`);
  }
}

/** Minimal poster projection returned by `GET /api/public/trending`. */
export interface TrendingPoster {
  id: string;
  title: string;
  poster: string;
}

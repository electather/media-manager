import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";

export class SettingsApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `settings request failed (${status})`);
    this.name = "SettingsApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

import type { DiagnosticsConfigBody } from "@ent-mcp/shared/diagnostics";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { safeJson } from "@/shared/lib/diagnostics/safe-json";
import { rangeToWindow } from "./format";
import { DiagnosticsApiError, type ErrorsFilters, type PerfFilters } from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new DiagnosticsApiError(res.status, body);
}

/** Builds the comma-delimited query shape the backend expects for list endpoints. */
function errorsQuery(filters: ErrorsFilters) {
  const window = rangeToWindow(filters.range);
  const out: Record<string, string> = {
    since: String(window.since),
    limit: "100",
  };
  if (filters.severity.length > 0 && filters.severity.length < 3) {
    out.severity = filters.severity.join(",");
  }
  if (filters.source.length > 0 && filters.source.length < 4) {
    out.source = filters.source.join(",");
  }
  if (filters.pluginId) out.pluginId = filters.pluginId;
  if (filters.requestId.trim()) out.requestId = filters.requestId.trim();
  if (filters.search.trim()) out.search = filters.search.trim();
  return out;
}

export async function fetchErrorList(filters: ErrorsFilters) {
  const res = await api.admin.diagnostics.errors.$get({ query: errorsQuery(filters) });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchErrorDetail(id: string) {
  const res = await api.admin.diagnostics.errors[":id"].$get({ param: { id } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchErrorSummary() {
  const res = await api.admin.diagnostics.errors.summary.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

function perfAggregateQuery(filters: PerfFilters) {
  const window = rangeToWindow(filters.range);
  const out: Record<string, string> = {
    since: String(window.since),
    groupBy: "route",
  };
  if (filters.kind !== "all") out.kind = filters.kind;
  return out;
}

export async function fetchPerfAggregate(filters: PerfFilters) {
  const res = await api.admin.diagnostics.perf.aggregate.$get({
    query: perfAggregateQuery(filters),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchPerfSummary() {
  const res = await api.admin.diagnostics.perf.summary.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchPerfDetail(id: string) {
  const res = await api.admin.diagnostics.perf[":id"].$get({ param: { id } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchDiagnosticsConfig() {
  const res = await api.admin.diagnostics.config.$get();
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchUpdateDiagnosticsConfig(body: DiagnosticsConfigBody) {
  const res = await api.admin.diagnostics.config.$put({ json: body });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

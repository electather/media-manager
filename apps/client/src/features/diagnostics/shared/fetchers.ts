import {
  ERROR_SEVERITIES,
  ERROR_SOURCES,
  type DiagnosticsConfigBody,
} from "@nama/shared/diagnostics";
import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { rangeToWindow } from "./ranges";
import { DiagnosticsApiError, type ErrorsFilters, type PerfFilters } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, DiagnosticsApiError);

/** Builds the comma-delimited query shape the backend expects for list endpoints.
 *  The param is sent verbatim for a partial selection and omitted only when
 *  every value is selected (the "all" optimisation). Empty selections never
 *  reach here — {@link fetchErrorList} short-circuits them. */
// fallow-ignore-next-line complexity
function errorsQuery(filters: ErrorsFilters) {
  const window = rangeToWindow(filters.range);
  const out: Record<string, string> = {
    since: String(window.since),
    limit: "100",
  };
  if (filters.severity.length < ERROR_SEVERITIES.length) {
    out.severity = filters.severity.join(",");
  }
  if (filters.source.length < ERROR_SOURCES.length) {
    out.source = filters.source.join(",");
  }
  if (filters.pluginId) out.pluginId = filters.pluginId;
  if (filters.requestId.trim()) out.requestId = filters.requestId.trim();
  if (filters.search.trim()) out.search = filters.search.trim();
  return out;
}

export async function fetchErrorList(filters: ErrorsFilters) {
  // Deselecting every severity or source means "show nothing". Omitting the
  // param would make the backend fall back to its defaults and return rows the
  // user explicitly filtered out, so resolve to an empty result without a
  // round trip instead.
  if (filters.severity.length === 0 || filters.source.length === 0) {
    return { records: [], total: 0 };
  }
  return readJson(await api.admin.diagnostics.errors.$get({ query: errorsQuery(filters) }));
}

export async function fetchErrorDetail(id: string) {
  return readJson(await api.admin.diagnostics.errors[":id"].$get({ param: { id } }));
}

export async function fetchErrorSummary() {
  return readJson(await api.admin.diagnostics.errors.summary.$get());
}

function perfAggregateQuery(filters: PerfFilters) {
  const window = rangeToWindow(filters.range);
  const out: Record<string, string> = {
    since: String(window.since),
    groupBy: "route",
  };
  if (filters.kind !== "all") out.kind = filters.kind;
  if (filters.requestId.trim()) out.requestId = filters.requestId.trim();
  return out;
}

export async function fetchPerfAggregate(filters: PerfFilters) {
  return readJson(
    await api.admin.diagnostics.perf.aggregate.$get({ query: perfAggregateQuery(filters) }),
  );
}

export async function fetchPerfSummary() {
  return readJson(await api.admin.diagnostics.perf.summary.$get());
}

export async function fetchPerfDetail(id: string) {
  return readJson(await api.admin.diagnostics.perf[":id"].$get({ param: { id } }));
}

export async function fetchDiagnosticsConfig() {
  return readJson(await api.admin.diagnostics.config.$get());
}

export async function fetchUpdateDiagnosticsConfig(body: DiagnosticsConfigBody) {
  return readJson(await api.admin.diagnostics.config.$put({ json: body }));
}

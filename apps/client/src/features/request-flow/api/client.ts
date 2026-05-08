import type {
  CreateMediaRequestBody,
  CreateMediaRequestResponse,
  RequestTarget,
} from "@ent-mcp/shared/media";
import { api } from "@/shared/lib/api";
import type { ApiErrorBody } from "@/shared/lib/errors/api-error-body";
import { safeJson } from "@/shared/lib/errors/safe-json";
import { RequestError } from "./errors";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as ApiErrorBody | null;
  throw new RequestError(res.status, body);
}

export const requestsApi = {
  async targets({ mediaType }: { mediaType: "movie" | "tv" }): Promise<RequestTarget[]> {
    const res = await api.requests.targets.$get({ query: { mediaType } });
    if (!res.ok) await throwOnError(res);
    const body = (await res.json()) as { targets: RequestTarget[] };
    return body.targets;
  },

  async create(body: CreateMediaRequestBody): Promise<CreateMediaRequestResponse> {
    const res = await api.requests.$post({ json: body });
    if (!res.ok) await throwOnError(res);
    return (await res.json()) as CreateMediaRequestResponse;
  },
};

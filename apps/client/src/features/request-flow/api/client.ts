import {
  createMediaRequestResponseSchema,
  mediaRequestsResponseSchema,
  requestTargetsResponseSchema,
  type CreateMediaRequestBody,
  type CreateMediaRequestResponse,
  type MediaRequestsResponse,
  type RequestTarget,
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
    // Parse against the shared schema so a server-side shape regression is
    // surfaced as a typed error here instead of a runtime crash deep inside
    // the picker render.
    return requestTargetsResponseSchema.parse(await res.json()).targets;
  },

  async create(body: CreateMediaRequestBody): Promise<CreateMediaRequestResponse> {
    const res = await api.requests.$post({ json: body });
    if (!res.ok) await throwOnError(res);
    return createMediaRequestResponseSchema.parse(await res.json());
  },

  async history(): Promise<MediaRequestsResponse> {
    const res = await api.requests.$get();
    if (!res.ok) await throwOnError(res);
    return mediaRequestsResponseSchema.parse(await res.json());
  },

  async cancel(requestId: string): Promise<{ ok: true }> {
    const res = await api.requests[":requestId"].$delete({ param: { requestId } });
    if (!res.ok) await throwOnError(res);
    return { ok: true };
  },
};

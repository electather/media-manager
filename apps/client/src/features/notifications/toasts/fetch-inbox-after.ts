import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { NotificationsApiError } from "../shared/types";

const readJson = <R extends Response>(res: R) => readOkJson(res, NotificationsApiError);

export async function fetchInboxAfter(
  cursor: string,
  opts: { unreadOnly?: boolean; limit?: number },
) {
  return readJson(
    await api.notifications.inbox.$get({
      query: {
        after: cursor,
        ...(opts.unreadOnly ? { unreadOnly: "true" as const } : {}),
        limit: String(opts.limit ?? 10),
      },
    }),
  );
}

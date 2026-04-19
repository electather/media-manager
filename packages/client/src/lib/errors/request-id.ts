const REQUEST_ID_HEADER = "X-Request-Id";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Returns a reasonable short form for display ("Ref: 7f3a2b1c"). */
export function shortRequestId(requestId: string): string {
  return requestId.replace(/-/g, "").slice(0, 8);
}

/** Fetch wrapper that stamps `X-Request-Id` on every outbound request and exposes the
 *  final request id to the caller via a returned tuple. The request id is generated if
 *  the server did not echo one back previously. */
export async function fetchWithRequestId(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<{ response: Response; requestId: string }> {
  const headers = new Headers(init.headers);
  let requestId = headers.get(REQUEST_ID_HEADER);
  if (!requestId) {
    requestId = generateId();
    headers.set(REQUEST_ID_HEADER, requestId);
  }
  const response = await fetch(input, { ...init, headers });
  const echoed = response.headers.get(REQUEST_ID_HEADER);
  return { response, requestId: echoed ?? requestId };
}

export { REQUEST_ID_HEADER };

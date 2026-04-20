export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export function jsonRpcResponse(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

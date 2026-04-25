/**
 * Reads a Response's JSON body without throwing on malformed payloads.
 * Used by error-handling paths that want to peek at a backend error body
 * without a `try`/`catch` at the call site.
 */
export async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

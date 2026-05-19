// fallow-ignore-file code-duplication

/**
 * Host-encoded `serviceId` codec. The wire format is
 * `${connectionId}:${pluginTargetId}` where `pluginTargetId` is plugin-controlled
 * and constrained to TARGET_ID_RE so the colon is the only delimiter the host
 * needs to reason about. The client treats `serviceId` as opaque.
 */
export const TARGET_ID_RE = /^[A-Za-z0-9_-]+$/;

export function encodeServiceId(connectionId: string, targetId: string): string {
  return `${connectionId}:${targetId}`;
}

export function decodeServiceId(
  serviceId: string,
): { connectionId: string; targetId: string } | null {
  const idx = serviceId.indexOf(":");
  if (idx <= 0 || idx === serviceId.length - 1) return null;
  const connectionId = serviceId.slice(0, idx);
  const targetId = serviceId.slice(idx + 1);
  if (!TARGET_ID_RE.test(targetId)) return null;
  return { connectionId, targetId };
}

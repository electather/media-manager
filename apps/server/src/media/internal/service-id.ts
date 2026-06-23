// fallow-ignore-file code-duplication

/** Host-encoded `serviceId` codec: `${connectionId}:${pluginTargetId}` where `pluginTargetId` matches TARGET_ID_RE.
 * Colon is the only delimiter; client treats `serviceId` as opaque.
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

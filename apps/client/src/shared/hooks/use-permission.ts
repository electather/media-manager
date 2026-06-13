import type { Permission } from "@nama/shared/auth";
import { authClient } from "@/shared/lib/auth";

/** Returns true when the current session grants `permission`, false when loading, error, or absent. */
export function usePermission(permission: Permission): boolean {
  const session = authClient.useSession();
  return session.data?.permissions?.includes(permission) ?? false;
}

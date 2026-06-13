import type { Permission } from "@nama/shared/auth";
import { authClient } from "@/shared/lib/auth";

/** Returns true when the current session grants at least one of `permissions`. */
export function useHasAnyPermission(permissions: Permission[]): boolean {
  const session = authClient.useSession();
  const granted = session.data?.permissions ?? [];
  return permissions.some((p) => granted.includes(p));
}

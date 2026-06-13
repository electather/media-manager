import type { ReactNode } from "react";
import type { Permission } from "@nama/shared/auth";
import { usePermission } from "@/shared/hooks/use-permission";

interface CanProps {
  permission: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders children when the current session grants permission, otherwise renders fallback or null. */
export function Can({ permission, fallback, children }: CanProps) {
  const allowed = usePermission(permission);
  return allowed ? <>{children}</> : <>{fallback ?? null}</>;
}

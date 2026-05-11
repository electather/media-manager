import { ShieldIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

interface Props {
  role: { id: string; name: string | null } | null;
  className?: string;
}

const VARIANTS = {
  admin: "border-primary/40 bg-primary/15 text-primary",
  member: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  viewer: "border-muted-foreground/30 bg-muted text-muted-foreground",
  custom: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
} as const;

function variantFor(id: string): keyof typeof VARIANTS {
  if (id === "role_admin") return "admin";
  if (id === "role_member") return "member";
  if (id === "role_viewer") return "viewer";
  return "custom";
}

export function RoleTag({ role, className }: Props) {
  if (!role) {
    return (
      <Badge variant="outline" className={cn("font-medium", className)}>
        {m.admin_users_no_role()}
      </Badge>
    );
  }
  const v = variantFor(role.id);
  return (
    <Badge variant="outline" className={cn("font-medium", VARIANTS[v], className)}>
      {v === "admin" ? <ShieldIcon className="size-3" aria-hidden="true" /> : null}
      {role.name}
    </Badge>
  );
}

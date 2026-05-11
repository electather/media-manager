import { ShieldIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface Props {
  roleId: string;
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

export function RoleGlyph({ roleId, className }: Props) {
  const v = variantFor(roleId);
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border",
        VARIANTS[v],
        className,
      )}
      aria-hidden="true"
    >
      <ShieldIcon className="size-4" />
    </span>
  );
}

import { cn } from "@/lib/utils";

export function MatchReason({ reason, className }: { reason: string; className?: string }) {
  return (
    <p className={cn("text-[11px] leading-tight text-muted-foreground line-clamp-2", className)}>
      {reason}
    </p>
  );
}

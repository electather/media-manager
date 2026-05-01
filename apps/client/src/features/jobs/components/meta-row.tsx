import { cn } from "@/shared/lib/utils";

export function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}

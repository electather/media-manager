import { cn } from "@/shared/lib/utils";

interface ScoreBlockProps {
  label: string;
  value: string;
  tone?: "default" | "accent";
}

export function ScoreBlock({ label, value, tone = "default" }: ScoreBlockProps) {
  return (
    <div className="flex min-w-22 flex-col gap-0.5 rounded-md bg-muted px-3.5 py-2">
      <div className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">{label}</div>
      <div
        className={cn(
          "text-lg font-semibold",
          tone === "accent" ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

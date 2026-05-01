import { cn } from "@/shared/lib/utils";

type TagChipsProps = {
  tags: readonly string[];
  max?: number;
  className?: string;
};

export function TagChips({ tags, max = 3, className }: TagChipsProps) {
  if (tags.length === 0) return null;
  const visible = tags.slice(0, max);
  return (
    <div className={cn("mt-1.5 flex flex-wrap gap-1", className)}>
      {visible.map((tag) => (
        <span
          key={tag}
          className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-tight tracking-[0.02em] text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

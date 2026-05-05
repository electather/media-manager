type Props = {
  tags?: string[];
  max?: number;
};

/** Small monospaced chips for quality tags (e.g. 4K, HDR, Atmos). */
export function CardTagChips({ tags, max = 3 }: Props) {
  if (!tags?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => (
        <span
          key={t}
          className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

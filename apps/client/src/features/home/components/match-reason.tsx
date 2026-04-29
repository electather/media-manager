interface MatchReasonProps {
  reason: string | undefined;
}

export function MatchReason({ reason }: MatchReasonProps) {
  if (!reason) return null;
  return (
    <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground sm:text-xs">
      {reason}
    </p>
  );
}

import { useNavigate } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { WatchlistSort } from "@ent-mcp/shared/watchlist";
import { WATCHLIST_SORTS } from "@ent-mcp/shared/watchlist";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

interface SortSelectProps {
  value: WatchlistSort;
}

export function SortSelect({ value }: SortSelectProps) {
  const navigate = useNavigate();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        void navigate({
          to: ".",
          search: (prev) => ({ ...prev, sort: next as WatchlistSort }),
          replace: false,
          resetScroll: false,
        });
      }}
    >
      <SelectTrigger size="sm" aria-label={m.watchlist_sort_label()}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WATCHLIST_SORTS.map((s) => (
          <SelectItem key={s} value={s}>
            {m.watchlist_sort({ sortKey: s })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

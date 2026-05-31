import { Search, X } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

interface LibrarySearchProps {
  value: string;
  onChange: (value: string) => void;
}

/** Free-text title search with a clear affordance, wired to the page filter state. */
export function LibrarySearch({ value, onChange }: LibrarySearchProps) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border bg-card ps-3 pe-1.5 focus-within:border-input">
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={m.library_search_placeholder()}
        aria-label={m.library_search_placeholder()}
        className="h-auto border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={m.library_search_clear()}
          onClick={() => onChange("")}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

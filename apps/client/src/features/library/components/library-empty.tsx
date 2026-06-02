import { SearchX } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";

/** Shown when search + filters exclude every title; offers a one-click reset. */
export function LibraryEmpty({ onReset }: { onReset: () => void }) {
  return (
    <Empty className="min-h-80">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.library_empty_title()}</EmptyTitle>
        <EmptyDescription>{m.library_empty_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onReset}>
          {m.library_empty_reset()}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import type { PaginationSlot as PaginationSlotModel } from "./use-pagination-slot";

// Title/body classes mirror `error-state`'s `ErrorStateTitle`/`ErrorStateDescription`
// but stay inline: the virtualized zone must not import from the components zone
// (fallow boundary-violation), and the slot needs no ErrorState context wrapper.
const SLOT_TITLE_CLASS =
  "font-heading text-sm font-semibold tracking-tight text-balance text-foreground";
const SLOT_BODY_CLASS = "text-xs leading-relaxed text-pretty text-muted-foreground";

interface PaginationSlotProps {
  slot: PaginationSlotModel;
  /**
   * `card` sizes the slot to one horizontal-row card via `--card-w`/`--card-h`
   * so the row's height stays stable when it swaps loading ↔ error ↔ none.
   * `row` is a full-width centered strip for vertical lists and grid footers.
   */
  variant: "card" | "row";
}

/**
 * Shared trailing pagination slot (#888): renders the loading / append-error /
 * nothing branch derived by `usePaginationSlot`, so horizontal rows, vertical
 * lists, and grids all recover from a *failed next page* the same way instead
 * of each hand-rolling a sentinel. Initial-load failure is a separate concern
 * (ErrorBoundary / full-region fallback) and never routes through here.
 */
export function PaginationSlot({ slot, variant }: PaginationSlotProps) {
  if (slot.state === "none") return null;
  if (variant === "card") return <PaginationSlotCard slot={slot} />;
  return <PaginationSlotRow slot={slot} />;
}

function PaginationSlotCard({ slot }: { slot: PaginationSlotModel }) {
  if (slot.state === "loading") {
    return (
      <div
        aria-live="polite"
        data-testid="pagination-slot-loading"
        className="flex h-(--card-h) w-(--card-w) shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground"
      >
        {m.shared_pagination_loading()}
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="pagination-slot-error"
      data-error-name={slot.error?.name}
      className="flex h-(--card-h) w-(--card-w) shrink-0 flex-col items-start justify-center gap-1.5 rounded-xl border border-dashed border-border bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--destructive)_18%,transparent)_0%,transparent_55%),var(--card)] px-4 py-4"
    >
      <div className="mb-1 flex size-8 items-center justify-center rounded-md bg-destructive/15 text-destructive">
        <CircleAlertIcon className="size-4" aria-hidden="true" />
      </div>
      <h3 className={SLOT_TITLE_CLASS}>{m.shared_pagination_error_message()}</h3>
      <p className={SLOT_BODY_CLASS}>{m.shared_pagination_error_body()}</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={slot.retry}
        disabled={slot.isRetrying}
        className="mt-auto"
      >
        <RotateCcwIcon className="size-3" aria-hidden="true" />
        {m.shared_pagination_retry()}
      </Button>
    </div>
  );
}

function PaginationSlotRow({ slot }: { slot: PaginationSlotModel }) {
  if (slot.state === "loading") {
    return (
      <div
        aria-live="polite"
        data-testid="pagination-slot-loading"
        className="px-4 py-6 text-center text-xs text-muted-foreground"
      >
        {m.shared_pagination_loading()}
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="pagination-slot-error"
      data-error-name={slot.error?.name}
      className="flex flex-col items-center gap-2 px-4 py-6 text-center"
    >
      <h3 className={SLOT_TITLE_CLASS}>{m.shared_pagination_error_message()}</h3>
      <p className={SLOT_BODY_CLASS}>{m.shared_pagination_error_body()}</p>
      <Button variant="ghost" size="sm" onClick={slot.retry} disabled={slot.isRetrying}>
        <RotateCcwIcon className="size-3.5" aria-hidden="true" />
        {m.shared_pagination_retry()}
      </Button>
    </div>
  );
}

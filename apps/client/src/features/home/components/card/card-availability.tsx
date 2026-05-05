import { Calendar, ChevronDown, Plus, Server } from "lucide-react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import type { CardAvailabilityState } from "../../lib/card-state";

type Props = { state: CardAvailabilityState };

const TONE: Record<CardAvailabilityState["kind"], string> = {
  server: "border-success/40 text-success",
  request: "border-primary/40 text-primary",
  requested: "border-primary/30 text-primary/85",
  upcoming: "border-border text-muted-foreground",
  info: "border-border text-muted-foreground",
};

function useLabel(state: CardAvailabilityState): string | null {
  if (state.kind === "info") return null;
  if (state.kind === "server")
    return state.serverPicker
      ? m.home_card_servers_count({ n: String(state.serverCount) })
      : (state.serverLabel ?? m.home_card_available());
  if (state.kind === "request") return m.home_card_request();
  if (state.kind === "requested") return m.home_card_requested();
  return m.home_card_upcoming();
}

function Glyph({ kind }: { kind: CardAvailabilityState["kind"] }) {
  if (kind === "request") return <Plus aria-hidden="true" className="size-3" />;
  if (kind === "upcoming") return <Calendar aria-hidden="true" className="size-3" />;
  if (kind === "server") return <Server aria-hidden="true" className="size-3" />;
  return null;
}

export function CardAvailability({ state }: Props) {
  const label = useLabel(state);
  if (label === null) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute start-2 top-2 inline-flex items-center gap-1 rounded-full border bg-card/65 px-2 py-0.5 text-[11px] font-medium backdrop-blur-md",
        TONE[state.kind],
      )}
    >
      <Glyph kind={state.kind} />
      {label}
      {state.serverPicker ? <ChevronDown aria-hidden="true" className="size-2.5" /> : null}
    </span>
  );
}

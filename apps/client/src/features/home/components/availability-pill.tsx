import { Calendar, ChevronDown, Plus, Server } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import * as m from "@/paraglide/messages";
import type { CardAvailabilityState } from "../lib/card-state";

type Props = {
  state: CardAvailabilityState;
  className?: string;
};

const availabilityPillVariants = cva(
  "inline-flex items-center gap-1 rounded-full border bg-card/65 px-2 py-0.5 text-xs font-medium backdrop-blur-md",
  {
    variants: {
      kind: {
        server: "border-success/40 text-success",
        request: "border-primary/40 text-primary",
        requested: "border-primary/30 text-primary/85",
        upcoming: "border-border text-muted-foreground",
        info: "border-border text-muted-foreground",
      } satisfies Record<CardAvailabilityState["kind"], string>,
    },
  },
);

type AvailabilityPillKind = NonNullable<VariantProps<typeof availabilityPillVariants>["kind"]>;

const LABEL_BY_KIND = {
  request: m.home_card_request,
  requested: m.home_card_requested,
  upcoming: m.home_card_upcoming,
  info: () => null,
} satisfies Record<Exclude<CardAvailabilityState["kind"], "server">, () => string | null>;

function serverLabel(state: CardAvailabilityState): string | null {
  if (state.serverPicker) return m.home_card_servers_count({ n: String(state.serverCount) });
  return state.serverLabel ?? m.home_card_available();
}

function labelFor(state: CardAvailabilityState): string | null {
  if (state.kind === "server") return serverLabel(state);
  return LABEL_BY_KIND[state.kind]();
}

function AvailabilityGlyph({ kind }: { kind: AvailabilityPillKind }) {
  if (kind === "request") return <Plus aria-hidden="true" className="size-3" />;
  if (kind === "upcoming") return <Calendar aria-hidden="true" className="size-3" />;
  if (kind === "server") return <Server aria-hidden="true" className="size-3" />;
  return null;
}

export function AvailabilityPill({ state, className }: Props) {
  const label = labelFor(state);
  if (label === null) return null;

  return (
    <span className={availabilityPillVariants({ kind: state.kind, className })}>
      <AvailabilityGlyph kind={state.kind} />
      {label}
      {state.serverPicker ? <ChevronDown aria-hidden="true" className="size-2.5" /> : null}
    </span>
  );
}

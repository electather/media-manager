import { useEffect, useState } from "react";
import { Check, Database, Plus, Server } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { createRequestPayload, resolveRequestSelection } from "../lib/request-helpers";
import type { RequestPayload, RequestService, ServiceGlyph } from "../lib/types";

type Props = {
  itemId: string;
  itemTitle: string;
  kind: "movie" | "tv";
  seasonNumbers?: number[];
  defaultServiceId?: string;
  defaultProfileId?: string;
  onSubmit: (payload: RequestPayload) => void;
  onCancel: () => void;
};

function ServiceGlyphIcon({ glyph, className }: { glyph: ServiceGlyph; className?: string }) {
  const Icon = glyph === "stack" ? Database : Server;
  return <Icon aria-hidden="true" className={className} />;
}

export function RequestPicker({
  itemId,
  itemTitle,
  kind,
  seasonNumbers = [],
  defaultServiceId,
  defaultProfileId,
  onSubmit,
  onCancel,
}: Props) {
  const initial = resolveRequestSelection(kind, defaultServiceId, defaultProfileId);
  const [draft, setDraft] = useState<{ serviceId: string | null; profileId: string | null }>({
    serviceId: initial.serviceId,
    profileId: initial.profileId,
  });

  useEffect(() => {
    const next = resolveRequestSelection(kind, defaultServiceId, defaultProfileId);
    setDraft({ serviceId: next.serviceId, profileId: next.profileId });
  }, [itemId, kind, defaultServiceId, defaultProfileId]);

  const selection = resolveRequestSelection(
    kind,
    draft.serviceId ?? undefined,
    draft.profileId ?? undefined,
  );
  const service = selection.service;

  const title =
    kind === "tv"
      ? seasonNumbers.length > 1
        ? m.request_picker_seasons_title({ n: String(seasonNumbers.length) })
        : m.request_picker_season_title()
      : m.request_picker_movie_title();

  const subline =
    kind === "tv"
      ? seasonNumbers.length > 1
        ? m.request_picker_subline_seasons({ numbers: seasonNumbers.join(", ") })
        : m.request_picker_subline_season({ n: String(seasonNumbers[0] ?? "") })
      : itemTitle;

  function submit() {
    if (!selection.serviceId) return;
    onSubmit(
      createRequestPayload({
        itemId,
        kind,
        serviceId: selection.serviceId,
        profileId: selection.profileId,
        seasonNumbers,
      }),
    );
  }

  return (
    <div className="flex w-80 flex-col gap-3 p-3">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{subline}</div>
      </div>

      <ServiceList
        services={selection.services}
        activeId={selection.serviceId}
        onSelect={(s) => setDraft({ serviceId: s.id, profileId: s.defaultProfileId })}
      />

      {service && service.exposesProfiles && service.profiles.length > 0 ? (
        <ProfileList
          profiles={service.profiles}
          activeId={selection.profileId}
          onSelect={(profileId) => setDraft((d) => ({ ...d, profileId }))}
        />
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {m.request_picker_cancel()}
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={!selection.serviceId}>
          <Plus aria-hidden="true" className="size-3.5" />
          {title}
        </Button>
      </div>
    </div>
  );
}

function ServiceList({
  services,
  activeId,
  onSelect,
}: {
  services: RequestService[];
  activeId: string | null;
  onSelect: (s: RequestService) => void;
}) {
  return (
    <div>
      <SectionLabel>{m.request_picker_section_server()}</SectionLabel>
      <div className="flex flex-col gap-1">
        {services.map((s) => {
          const on = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className={cn(
                "flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-start transition-colors",
                on
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-transparent text-foreground hover:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md border",
                  on
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground",
                )}
              >
                <ServiceGlyphIcon glyph={s.glyph} className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{s.label}</span>
                <span className="truncate text-[11px] text-muted-foreground">{s.sub}</span>
              </span>
              {on ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileList({
  profiles,
  activeId,
  onSelect,
}: {
  profiles: { id: string; label: string; detail: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <SectionLabel>{m.request_picker_section_quality()}</SectionLabel>
      <div className="flex flex-col gap-1">
        {profiles.map((p) => {
          const on = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-start transition-colors",
                on
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-transparent text-foreground hover:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full border-[1.5px]",
                  on ? "border-primary bg-primary" : "border-border bg-transparent",
                )}
                aria-hidden="true"
              />
              <span className="flex-1 text-xs font-medium">{p.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{p.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

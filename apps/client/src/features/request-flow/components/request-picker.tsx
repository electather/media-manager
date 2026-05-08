import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Server } from "lucide-react";
import type { RequestProfile, RequestTarget } from "@ent-mcp/shared/media";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { useRequestTargets } from "../api/use-request-targets";

export type PickerSubmission = {
  serviceId: string;
  profileId: string | null;
  /** UI-local descriptor used by callers to render destination tooltips. */
  serviceLabel: string;
  profileLabel: string | null;
};

type Props = {
  itemTitle: string;
  mediaType: "movie" | "tv";
  seasonNumbers?: number[];
  onSubmit: (submission: PickerSubmission) => void;
  onCancel: () => void;
  pending?: boolean;
};

function pickInitialTarget(targets: RequestTarget[]): RequestTarget | null {
  return targets[0] ?? null;
}

function pickInitialProfileId(target: RequestTarget | null): string | null {
  if (!target) return null;
  if (!target.exposesProfiles || target.profiles.length === 0) return null;
  if (target.defaultProfileId && target.profiles.some((p) => p.id === target.defaultProfileId)) {
    return target.defaultProfileId;
  }
  return target.profiles[0]?.id ?? null;
}

export function RequestPicker({
  itemTitle,
  mediaType,
  seasonNumbers = [],
  onSubmit,
  onCancel,
  pending = false,
}: Props) {
  const targets = useRequestTargets(mediaType);

  const [serviceId, setServiceId] = useState<string | null>(
    () => pickInitialTarget(targets)?.serviceId ?? null,
  );
  const [profileId, setProfileId] = useState<string | null>(() =>
    pickInitialProfileId(pickInitialTarget(targets)),
  );

  // Refresh selection when the target list changes underneath (cache refresh,
  // first hydration). Only resets when the chosen target disappears.
  useEffect(() => {
    if (!targets.length) {
      setServiceId(null);
      setProfileId(null);
      return;
    }
    if (!targets.some((t) => t.serviceId === serviceId)) {
      const next = pickInitialTarget(targets);
      setServiceId(next?.serviceId ?? null);
      setProfileId(pickInitialProfileId(next));
    }
  }, [targets, serviceId]);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.serviceId === serviceId) ?? null,
    [targets, serviceId],
  );

  const heading = pickerHeading(mediaType, seasonNumbers, itemTitle);
  const { title, subline } = heading;

  if (targets.length === 0) {
    return (
      <div className="flex w-80 flex-col gap-3 p-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{subline}</div>
        </div>
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {m.request_picker_empty_targets()}
        </p>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {m.request_picker_cancel()}
          </Button>
        </div>
      </div>
    );
  }

  function submit() {
    if (!selectedTarget) return;
    const profile = selectedTarget.profiles.find((p) => p.id === profileId) ?? null;
    onSubmit({
      serviceId: selectedTarget.serviceId,
      profileId,
      serviceLabel: selectedTarget.label,
      profileLabel: profile?.label ?? null,
    });
  }

  return (
    <div className="flex w-80 flex-col gap-3 p-3">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{subline}</div>
      </div>

      <ServiceList
        targets={targets}
        activeId={serviceId}
        onSelect={(t) => {
          setServiceId(t.serviceId);
          setProfileId(pickInitialProfileId(t));
        }}
      />

      {selectedTarget && selectedTarget.exposesProfiles && selectedTarget.profiles.length > 0 ? (
        <ProfileList
          profiles={selectedTarget.profiles}
          activeId={profileId}
          onSelect={setProfileId}
        />
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          {m.request_picker_cancel()}
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={!selectedTarget || pending}>
          <Plus aria-hidden="true" className="size-3.5" />
          {title}
        </Button>
      </div>
    </div>
  );
}

type PickerHeading = { title: string; subline: string };

function pickerHeading(
  mediaType: "movie" | "tv",
  seasonNumbers: number[],
  itemTitle: string,
): PickerHeading {
  if (mediaType === "movie") {
    return { title: m.request_picker_movie_title(), subline: itemTitle };
  }
  if (seasonNumbers.length > 1) {
    return {
      title: m.request_picker_seasons_title({ n: String(seasonNumbers.length) }),
      subline: m.request_picker_subline_seasons({ numbers: seasonNumbers.join(", ") }),
    };
  }
  return {
    title: m.request_picker_season_title(),
    subline: m.request_picker_subline_season({ n: String(seasonNumbers[0] ?? "") }),
  };
}

function ServiceList({
  targets,
  activeId,
  onSelect,
}: {
  targets: RequestTarget[];
  activeId: string | null;
  onSelect: (t: RequestTarget) => void;
}) {
  return (
    <div>
      <SectionLabel>{m.request_picker_section_server()}</SectionLabel>
      <div className="flex flex-col gap-1">
        {targets.map((t) => {
          const on = t.serviceId === activeId;
          return (
            <button
              key={t.serviceId}
              type="button"
              onClick={() => onSelect(t)}
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
                <Server aria-hidden="true" className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{t.label}</span>
                <span className="truncate text-[11px] text-muted-foreground">{t.pluginId}</span>
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
  profiles: RequestProfile[];
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
              {p.detail ? (
                <span className="font-mono text-[10px] text-muted-foreground">{p.detail}</span>
              ) : null}
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

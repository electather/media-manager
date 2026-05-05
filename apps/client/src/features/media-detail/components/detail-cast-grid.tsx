import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "@/features/home/lib/types";

type CastEntry = { name: string; role: string };

const SUPPORTING_ROLES = [
  "media_detail_role_lead",
  "media_detail_role_co_lead",
  "media_detail_role_supporting",
  "media_detail_role_supporting",
  "media_detail_role_recurring",
  "media_detail_role_recurring",
] as const satisfies readonly (keyof typeof m)[];

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function buildEntries(item: HomeMediaItem): CastEntry[] {
  const entries: CastEntry[] = [];
  if (item.director) {
    entries.push({ name: item.director, role: m.media_detail_role_director() });
  }
  if (item.cast) {
    item.cast.forEach((name, index) => {
      const roleKey = SUPPORTING_ROLES[index] ?? "media_detail_role_cast";
      entries.push({ name, role: m[roleKey]() });
    });
  }
  return entries;
}

export function DetailCastGrid({ item }: { item: HomeMediaItem }) {
  const entries = buildEntries(item);
  if (entries.length === 0) return null;

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 list-none p-0">
      {entries.map((entry, index) => (
        <li
          key={`${entry.name}-${index}`}
          className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5"
        >
          <CastAvatar index={index} name={entry.name} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{entry.name}</div>
            <div className="text-xs text-muted-foreground">{entry.role}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CastAvatar({ index, name }: { index: number; name: string }) {
  const hueA = (index * 47) % 360;
  const hueB = (index * 47 + 120) % 360;
  return (
    <div
      aria-hidden="true"
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-foreground"
      style={{
        background: `linear-gradient(135deg, oklch(0.55 0.10 ${hueA}), oklch(0.40 0.08 ${hueB}))`,
      }}
    >
      {initials(name)}
    </div>
  );
}

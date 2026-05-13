import * as m from "@/paraglide/messages";
import type { MediaDetailItem } from "./types";

export function ModalCredits({ item }: { item: MediaDetailItem }) {
  const hasCast = Boolean(item.cast && item.cast.length > 0);
  if (!hasCast && !item.director) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-6 text-sm sm:px-10">
      <DirectorRow value={item.director} />
      <CastRow value={item.cast} />
    </dl>
  );
}

function DirectorRow({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted-foreground">{m.home_detail_director()}</dt>
      <dd className="text-foreground/90">{value}</dd>
    </>
  );
}

function CastRow({ value }: { value?: string[] }) {
  if (!value || value.length === 0) return null;
  return (
    <>
      <dt className="text-muted-foreground">{m.home_detail_cast()}</dt>
      <dd className="text-foreground/90">{value.join(", ")}</dd>
    </>
  );
}

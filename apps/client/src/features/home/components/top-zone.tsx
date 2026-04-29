import type { LayoutHero } from "@ent-mcp/shared/home";

import { Card } from "./card";

interface TopZoneProps {
  hero: LayoutHero | null;
}

export function TopZone({ hero }: TopZoneProps) {
  if (!hero) return null;
  return (
    <section className="grid gap-4 px-4 sm:px-6">
      <Card item={hero.item} isHero />
    </section>
  );
}

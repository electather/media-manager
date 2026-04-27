import type { HomeRowStub, LayoutHero } from "@ent-mcp/shared/home";
import { Hero } from "./hero";
import { SidebarColumn } from "./sidebar-column";

export interface TopZoneProps {
  hero: LayoutHero | null;
  sidebarRow: HomeRowStub | null;
}

export function TopZone({ hero, sidebarRow }: TopZoneProps) {
  if (!hero && !sidebarRow) return null;

  return (
    <div data-testid="top-zone" className="@container px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-4 @[768px]:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] @[768px]:gap-6">
        {hero ? <Hero hero={hero} /> : null}
        {sidebarRow ? (
          <div className="@[768px]:block">
            <SidebarColumn row={sidebarRow} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

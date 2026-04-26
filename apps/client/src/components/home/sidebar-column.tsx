import type { HomeRow } from "@ent-mcp/shared/home";
import { SidebarItem } from "./sidebar-item";

export function SidebarColumn({ row }: { row: HomeRow }) {
  const title = row.titleOverride ?? row.title;
  return (
    <section aria-labelledby={`sidebar-${row.rowId}`} className="flex flex-col gap-3">
      <h2
        id={`sidebar-${row.rowId}`}
        data-testid="sidebar-title"
        className="text-[15px] font-medium text-foreground"
      >
        {title}
      </h2>
      <div className="flex flex-col gap-2">
        {row.items.map((item) => (
          <SidebarItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

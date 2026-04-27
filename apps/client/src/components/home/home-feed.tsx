import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { HomeLayoutResponse, RowKind } from "@ent-mcp/shared/home";
import { useHomeLayout } from "@/hooks/use-home-layout";
import { ROW_DISPLAY } from "@/lib/home-display";
import { HomeFeedSkeleton } from "./home-feed-skeleton";
import { HomeFeedEmpty } from "./home-feed-empty";
import { HomeFeedError } from "./home-feed-error";
import { TopZone } from "./top-zone";
import { Row } from "./row";

interface ContentProps {
  data: HomeLayoutResponse;
}

export function HomeFeed() {
  const query = useHomeLayout();

  if (query.isPending && !query.data) return <HomeFeedSkeleton />;
  if (query.isError && !query.data) return <HomeFeedError onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data) return <HomeFeedSkeleton />;
  if (!data.hero && data.rows.length === 0) return <HomeFeedEmpty />;

  return <HomeFeedContent data={data} />;
}

function HomeFeedContent({ data }: ContentProps) {
  const [removedRows, setRemovedRows] = useState<Set<RowKind>>(new Set());

  const handleRowUnavailable = (rowId: RowKind, title: string) => {
    setRemovedRows((prev) => {
      if (prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.add(rowId);
      toast(`${title} is no longer available.`);
      return next;
    });
  };

  const sidebarRow = useMemo(
    () =>
      data.rows.find((r) => ROW_DISPLAY[r.rowId].slot === "sidebar" && !removedRows.has(r.rowId)) ??
      null,
    [data.rows, removedRows],
  );

  // When hero is absent, the sidebar has no top-zone partner to balance it,
  // so promote it to a regular row at the head of the feed (design doc
  // §States: "Sidebar collapses, renders as horizontal-scroll row at top of
  // rows[]"). TopZone short-circuits when its hero prop is null below.
  const heroAbsent = data.hero === null;
  const promotedSidebar = heroAbsent ? sidebarRow : null;
  const topSidebar = heroAbsent ? null : sidebarRow;

  const mainRows = useMemo(
    () =>
      data.rows.filter((r) => ROW_DISPLAY[r.rowId].slot === "main" && !removedRows.has(r.rowId)),
    [data.rows, removedRows],
  );

  const orderedRows = promotedSidebar ? [promotedSidebar, ...mainRows] : mainRows;

  const sidebarTitle = topSidebar?.title;
  const handleSidebarUnavailable = topSidebar
    ? (rowId: RowKind) => handleRowUnavailable(rowId, sidebarTitle ?? rowId)
    : undefined;

  return (
    <div className="flex flex-col gap-6 py-4 md:gap-8 md:py-6">
      <TopZone
        hero={data.hero}
        sidebarRow={topSidebar}
        onSidebarRowUnavailable={handleSidebarUnavailable}
      />
      {orderedRows.map((row) => (
        <Row
          key={row.rowId}
          row={row}
          onRowUnavailable={(rowId) => handleRowUnavailable(rowId, row.title)}
        />
      ))}
    </div>
  );
}

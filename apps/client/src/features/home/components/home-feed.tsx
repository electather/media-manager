import { useCallback, useState } from "react";
import type { HomeRowStub, RowKind } from "@ent-mcp/shared/home";

import { useHomeLayout } from "../hooks/use-home-layout";
import { HomeFeedEmpty } from "./home-feed-empty";
import { HomeFeedError } from "./home-feed-error";
import { HomeFeedSkeleton } from "./home-feed-skeleton";
import { Row } from "./row";
import { TopZone } from "./top-zone";

export function HomeFeed() {
  const layout = useHomeLayout();
  const [removed, setRemoved] = useState<Set<RowKind>>(() => new Set());

  const dropRow = useCallback((rowId: RowKind) => {
    setRemoved((prev) => {
      if (prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  }, []);

  if (layout.isLoading) return <HomeFeedSkeleton />;
  if (layout.error) return <HomeFeedError onRetry={() => void layout.refetch()} />;

  const data = layout.data;
  if (!data) return <HomeFeedSkeleton />;

  const rows: HomeRowStub[] = data.rows.filter((r) => !removed.has(r.rowId));
  if (!data.hero && rows.length === 0) return <HomeFeedEmpty />;

  return (
    <div className="flex flex-col gap-8 py-4 md:py-6">
      <TopZone hero={data.hero} />
      {rows.map((row) => (
        <Row key={row.rowId} stub={row} onUnavailable={dropRow} />
      ))}
    </div>
  );
}

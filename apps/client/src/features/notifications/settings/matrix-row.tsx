import type { NotificationCategory } from "@ent-mcp/shared/notifications";
import { MatrixCell } from "./matrix-cell";

interface CategoryEntry {
  id: NotificationCategory;
  label: string;
  requiredPermission: string;
  allowed: boolean;
}

interface SubscriptionRow {
  connectionId: string;
  category: NotificationCategory;
  enabled: boolean;
}

interface Props {
  channelId: string;
  channelLabel: string;
  categories: CategoryEntry[];
  subscriptions: SubscriptionRow[];
  forceOnAll?: boolean;
}

export function MatrixRow({
  channelId,
  channelLabel,
  categories,
  subscriptions,
  forceOnAll,
}: Props) {
  const subMap = new Map(
    subscriptions
      .filter((s) => s.connectionId === channelId)
      .map((s) => [s.category, s.enabled] as const),
  );
  return (
    <tr className="border-b border-border/50">
      <th scope="row" className="px-3 py-2 text-left text-sm font-medium">
        {channelLabel}
      </th>
      {categories.map((c) => (
        <td key={c.id} className="px-3 py-2 text-center">
          <MatrixCell
            connectionId={channelId}
            category={c.id}
            enabled={subMap.get(c.id) ?? false}
            allowed={c.allowed}
            requiredPermission={c.requiredPermission}
            {...(forceOnAll ? { forceOn: true } : {})}
          />
        </td>
      ))}
    </tr>
  );
}

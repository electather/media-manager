import { m } from "@/paraglide/messages";
import { useCategories } from "./use-categories";
import { useChannels } from "./use-channels";
import { useSubscriptions } from "./use-subscriptions";
import { MatrixRow } from "./matrix-row";

export function SubscriptionsMatrix() {
  const { data: catData } = useCategories();
  const { data: chData } = useChannels();
  const { data: subData } = useSubscriptions();
  const categories = catData.categories;
  const channels = chData.channels;
  const subscriptions = subData.subscriptions;

  return (
    <section className="rounded-lg border border-border">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{m.notifications_settings_subscriptions_title()}</h2>
      </header>
      <table className="w-full table-auto text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left">
              Channel
            </th>
            {categories.map((c) => (
              <th key={c.id} scope="col" className="px-3 py-2 text-center">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <MatrixRow
            channelId="__inbox__"
            channelLabel={m.notifications_settings_inbox_channel()}
            categories={categories}
            subscriptions={[]}
            forceOnAll
          />
          {channels.map((ch) => (
            <MatrixRow
              key={ch.id}
              channelId={ch.id}
              channelLabel={ch.displayName ?? ch.pluginId}
              categories={categories}
              subscriptions={subscriptions}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

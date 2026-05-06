import { describe, expect, it } from "vite-plus/test";

import { notificationsKeys } from "../query-keys";

describe("notificationsKeys", () => {
  it("namespaces every key under notifications", () => {
    expect(notificationsKeys.all[0]).toBe("notifications");
    expect(notificationsKeys.unreadCount()[0]).toBe("notifications");
    expect(notificationsKeys.inbox({})[0]).toBe("notifications");
    expect(notificationsKeys.popoverInbox({})[0]).toBe("notifications");
  });

  it("nests popover inbox under the inbox prefix so inboxAll matches both", () => {
    const prefix = notificationsKeys.inboxAll();
    const inboxKey = notificationsKeys.inbox({});
    const popoverKey = notificationsKeys.popoverInbox({});
    expect(inboxKey.slice(0, prefix.length)).toEqual([...prefix]);
    expect(popoverKey.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it("keeps inbox and popover keys distinct so they do not share a cache entry", () => {
    expect(notificationsKeys.inbox({})).not.toEqual(notificationsKeys.popoverInbox({}));
    const filters = { unreadOnly: true } as const;
    expect(notificationsKeys.inbox(filters)).not.toEqual(notificationsKeys.popoverInbox(filters));
  });

  it("admin delivery list and detail keys do not collide", () => {
    const list = notificationsKeys.admin.deliveries({});
    const detail = notificationsKeys.admin.delivery("d_1");
    expect(list).not.toEqual(detail);
    expect(list.slice(0, 3)).toEqual([...notificationsKeys.admin.deliveriesAll()]);
  });
});

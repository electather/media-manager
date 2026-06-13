import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@nama/plugin-sdk";
import {
  createTestNotificationContext,
  jsonRes,
  type TestNotificationContext,
} from "@nama/plugin-sdk/testing";
import seerrPlugin from "../src/plugin";

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestNotificationContext {
  return createTestNotificationContext({
    responses,
    overrides: {
      userId: "user-1",
      credentials: { sessionCookie: "connect.sid=xyz", userId: 1 },
      config: { global: { baseUrl: "https://seerr.example.com" }, user: null },
      ...overrides,
    },
  });
}

interface RequestRow {
  id: number;
  status: number;
  type?: "movie" | "tv";
  createdAt?: string;
  media?: { tmdbId: number; title?: string; posterPath?: string };
}

function listResponse(rows: RequestRow[]): Response {
  return jsonRes({
    results: rows.map((r) => ({
      id: r.id,
      type: r.type ?? "movie",
      status: r.status,
      createdAt: r.createdAt ?? "2026-01-01T00:00:00Z",
      media: r.media ?? { tmdbId: r.id * 10, title: `Title ${r.id}` },
    })),
  });
}

const syncJob = seerrPlugin.jobs!.syncRequestStatuses!;

describe("seerr requestStatusSync emit", () => {
  it("baselines on first run without emitting", async () => {
    const ctx = makeCtx([listResponse([{ id: 1, status: 1 }])]);
    await syncJob(ctx);
    expect(ctx.emittedNotifications).toHaveLength(0);
  });

  it("emits media.request.available on pending → available transition", async () => {
    const seenStore = new Map<string, unknown>();
    seenStore.set("seerr.requestStatuses.v1", { "1": "pending" });
    const ctx = makeCtx([listResponse([{ id: 1, status: 4 }])], {
      store: {
        async get(key: string) {
          return seenStore.get(key);
        },
        async set(key: string, value: unknown) {
          seenStore.set(key, value);
        },
        async delete(key: string) {
          seenStore.delete(key);
        },
      },
    });

    await syncJob(ctx);

    expect(ctx.emittedNotifications).toHaveLength(1);
    const event = ctx.emittedNotifications[0]!;
    expect(event).toMatchObject({
      type: "media.request.available",
      category: "media",
      severity: "info",
      audience: { kind: "user", userId: "user-1" },
      payload: { requestId: "1", mediaId: "10", title: "Title 1" },
    });
  });

  it("emits media.request.denied on pending → failed transition", async () => {
    const seenStore = new Map<string, unknown>();
    seenStore.set("seerr.requestStatuses.v1", { "2": "pending" });
    const ctx = makeCtx([listResponse([{ id: 2, status: 3 }])], {
      store: {
        async get(key: string) {
          return seenStore.get(key);
        },
        async set(key: string, value: unknown) {
          seenStore.set(key, value);
        },
        async delete(key: string) {
          seenStore.delete(key);
        },
      },
    });

    await syncJob(ctx);

    expect(ctx.emittedNotifications).toHaveLength(1);
    expect(ctx.emittedNotifications[0]).toMatchObject({
      type: "media.request.denied",
      severity: "warn",
      audience: { kind: "user", userId: "user-1" },
      payload: { requestId: "2", mediaId: "20" },
    });
  });

  it("does not emit when status is unchanged", async () => {
    const seenStore = new Map<string, unknown>();
    seenStore.set("seerr.requestStatuses.v1", { "5": "available" });
    const ctx = makeCtx([listResponse([{ id: 5, status: 4 }])], {
      store: {
        async get(key: string) {
          return seenStore.get(key);
        },
        async set(key: string, value: unknown) {
          seenStore.set(key, value);
        },
        async delete(key: string) {
          seenStore.delete(key);
        },
      },
    });

    await syncJob(ctx);

    expect(ctx.emittedNotifications).toHaveLength(0);
  });

  it("skips silently when ctx.userId is null", async () => {
    const ctx = makeCtx([listResponse([{ id: 1, status: 4 }])], { userId: null });
    await syncJob(ctx);
    expect(ctx.emittedNotifications).toHaveLength(0);
  });
});

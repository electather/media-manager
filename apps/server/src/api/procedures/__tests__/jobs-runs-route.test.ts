import { describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { jobRunsQuerySchema as runsQuerySchema } from "@ent-mcp/shared/jobs";
import { zValidator } from "../../../errors/validator";

// Stand-alone reconstruction of the runs route to verify routing + handler
// behavior in isolation from auth middleware and the live job registry.
function buildApp(handler: (id: string, limit: number) => Promise<unknown[]>) {
  return new Hono().get("/:id/runs", zValidator("query", runsQuerySchema), async (c) => {
    const id = c.req.param("id");
    const { limit } = c.req.valid("query");
    const runs = await handler(id, limit);
    return c.json({ runs } as const);
  });
}

describe("admin jobs runs route", () => {
  it("matches dotted job ids and forwards limit", async () => {
    const handler = vi.fn(async (_id: string, _limit: number) => [
      { id: "run-a", jobId: _id, status: "succeeded" },
    ]);
    const app = buildApp(handler);
    const res = await app.request("/host.preference.incremental_update/runs?limit=30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith("host.preference.incremental_update", 30);
  });

  it("defaults limit when omitted", async () => {
    const handler = vi.fn(async (_id: string, _limit: number) => [] as unknown[]);
    const app = buildApp(handler);
    const res = await app.request("/abc/runs");
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith("abc", 20);
  });
});

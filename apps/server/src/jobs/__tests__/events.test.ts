import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

interface FakeEntry {
  handler: (ctx: unknown, input: unknown) => Promise<unknown>;
  triggerFromApi: (input: unknown) => Promise<{ runId: string; result: unknown }>;
}

const fakeRegistry = new Map<string, FakeEntry>();
let nextRunId = 0;

/**
 * Stub job infra so typed wrapper is exercised without real runner (writes to job_runs/logs).
 * Fake registry stores handlers; triggerFromApi invokes inline, mirroring runner dispatch semantics.
 */
vi.mock("../triggerable", () => ({
  registerTriggerable: (opts: {
    id: string;
    handler: (ctx: unknown, input: unknown) => Promise<unknown>;
  }) => {
    const entry: FakeEntry = {
      handler: opts.handler,
      triggerFromApi: async (input) => {
        const result = await opts.handler({ runId: `r-${nextRunId++}` }, input);
        return { runId: `r-${nextRunId}`, result };
      },
    };
    fakeRegistry.set(opts.id, entry);
    return { id: opts.id };
  },
}));

vi.mock("../registry", () => ({
  findEntry: (id: string) => fakeRegistry.get(id),
}));

vi.mock("../../diagnostics/request-context", () => ({
  newRequestId: () => "test-req",
}));

const { emit, on, __resetHandlerRegistryForTests, registeredEventNames } =
  await import("../events");

beforeEach(() => {
  fakeRegistry.clear();
  __resetHandlerRegistryForTests();
});

afterEach(() => {
  fakeRegistry.clear();
  __resetHandlerRegistryForTests();
});

describe("jobs/events: typed emit + on wrapper", () => {
  const schema = z.object({ value: z.number() });
  type Payload = z.infer<typeof schema>;

  it("dispatches a single registered handler with the parsed payload", async () => {
    const handler = vi.fn<(p: Payload) => Promise<void>>(async () => undefined);
    on("test.single.fired" as never, schema, handler);

    await emit("test.single.fired" as never, schema, { value: 42 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it("fans out: multiple on() registrations invoke all handlers in registration order", async () => {
    const order: string[] = [];
    on("test.fanout.fired" as never, schema, async () => {
      order.push("first");
    });
    on("test.fanout.fired" as never, schema, async () => {
      order.push("second");
    });
    on("test.fanout.fired" as never, schema, async () => {
      order.push("third");
    });

    await emit("test.fanout.fired" as never, schema, { value: 1 });

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("a thrown handler aborts remaining handlers and propagates to the runner", async () => {
    const calls: string[] = [];
    on("test.throw.fired" as never, schema, async () => {
      calls.push("a");
    });
    on("test.throw.fired" as never, schema, async () => {
      calls.push("b");
      throw new Error("boom");
    });
    on("test.throw.fired" as never, schema, async () => {
      calls.push("c");
    });

    await expect(emit("test.throw.fired" as never, schema, { value: 1 })).rejects.toThrow("boom");
    expect(calls).toEqual(["a", "b"]);
  });

  it("rejects at emit when the payload fails zod validation; nothing enqueued", async () => {
    const handler = vi.fn<(p: Payload) => Promise<void>>(async () => undefined);
    on("test.zod-emit.fired" as never, schema, handler);

    await expect(
      emit("test.zod-emit.fired" as never, schema, { value: "not-a-number" } as unknown as Payload),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("propagates a dispatch-time zod failure to the runner", async () => {
    const handler = vi.fn<(p: Payload) => Promise<void>>(async () => undefined);
    on("test.zod-dispatch.fired" as never, schema, handler);

    // Bypass the wrapper's emit-time validation by calling the underlying
    // triggerFromApi directly with a malformed payload. The dispatcher inside
    // `on` will re-parse and throw — same propagation path the runner sees.
    const entry = fakeRegistry.get("test.zod-dispatch.fired");
    if (!entry) throw new Error("fake registry missing entry");
    await expect(entry.triggerFromApi({ value: "bad" })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("registeredEventNames lists every event with at least one handler", () => {
    on("test.list.a" as never, schema, async () => undefined);
    on("test.list.b" as never, schema, async () => undefined);
    on("test.list.b" as never, schema, async () => undefined);
    expect(new Set(registeredEventNames())).toEqual(new Set(["test.list.a", "test.list.b"]));
  });
});

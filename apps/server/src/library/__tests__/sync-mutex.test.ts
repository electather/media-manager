import { describe, expect, it } from "vite-plus/test";
import { PerUserMutex } from "../internal/sync-mutex";

describe("PerUserMutex", () => {
  // The read-then-update slow path in `tombstoneMissing` is only safe if two
  // syncs for the same user never interleave (#911). If they did, both would
  // observe the same owned set and the second's stale read could tombstone a
  // row the first just inserted. This asserts no overlap for the same key.
  it("serializes tasks for the same user", async () => {
    const mutex = new PerUserMutex();
    const events: string[] = [];
    const gate = (label: string) => async () => {
      events.push(`${label}:start`);
      await Promise.resolve();
      await Promise.resolve();
      events.push(`${label}:end`);
    };

    await Promise.all([mutex.run("u1", gate("a")), mutex.run("u1", gate("b"))]);

    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("runs different users concurrently", async () => {
    const mutex = new PerUserMutex();
    const events: string[] = [];
    const gate = (label: string) => async () => {
      events.push(`${label}:start`);
      await Promise.resolve();
      events.push(`${label}:end`);
    };

    await Promise.all([mutex.run("u1", gate("a")), mutex.run("u2", gate("b"))]);

    // Interleaved: both start before either ends.
    expect(events.slice(0, 2)).toEqual(["a:start", "b:start"]);
  });

  it("keeps the chain alive after a task rejects", async () => {
    const mutex = new PerUserMutex();
    await expect(mutex.run("u1", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    // A prior rejection must not deadlock the next caller for the same user.
    await expect(mutex.run("u1", () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("serializes three tasks in FIFO order without a mid-chain gap", async () => {
    // Three queued tasks exercise the slot-ownership guard: when the middle
    // task drains, the slot already points at the third's chain, so its
    // `finally` must NOT clear the slot — otherwise the third would run
    // against a fresh chain and could overlap. FIFO across all three proves it.
    const mutex = new PerUserMutex();
    const events: string[] = [];
    const gate = (label: string) => async () => {
      events.push(`${label}:start`);
      await Promise.resolve();
      await Promise.resolve();
      events.push(`${label}:end`);
    };

    await Promise.all([
      mutex.run("u1", gate("a")),
      mutex.run("u1", gate("b")),
      mutex.run("u1", gate("c")),
    ]);

    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });
});

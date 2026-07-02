import { describe, expect, it } from "vite-plus/test";
import { pluginError } from "@nama/plugin-sdk";
import {
  BACKOFF_INTERVALS_MS,
  MAX_ATTEMPTS,
  decideFailure,
  pickRetryDelayMs,
} from "../internal/delivery-policy";

describe("delivery backoff schedule", () => {
  it("matches the design's [60s, 5m, 30m, 2h, 12h] schedule", () => {
    expect(BACKOFF_INTERVALS_MS).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * 60 * 60_000,
      12 * 60 * 60_000,
    ]);
  });

  it("caps total attempts at 6 (initial + 5 retries) so every entry in the schedule is reachable", () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect(MAX_ATTEMPTS).toBe(BACKOFF_INTERVALS_MS.length + 1);
  });
});

describe("decideFailure: retry scheduling", () => {
  function retryableErr(retryAfterMs?: number) {
    return pluginError("plugin.upstream_error", "boom", {
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  it("attempt 1 retryable failure → 60s delay", () => {
    const d = decideFailure({ attemptCount: 0 }, retryableErr());
    expect(d.action).toBe("reschedule");
    if (d.action !== "reschedule") return;
    expect(d.delayMs).toBe(60_000);
  });

  it("attempt 2 retryable failure → 5m delay", () => {
    const d = decideFailure({ attemptCount: 1 }, retryableErr());
    expect(d.action).toBe("reschedule");
    if (d.action !== "reschedule") return;
    expect(d.delayMs).toBe(5 * 60_000);
  });

  it("attempt 3 retryable failure → 30m delay", () => {
    const d = decideFailure({ attemptCount: 2 }, retryableErr());
    expect(d.action).toBe("reschedule");
    if (d.action !== "reschedule") return;
    expect(d.delayMs).toBe(30 * 60_000);
  });

  it("attempt 4 retryable failure → 2h delay", () => {
    const d = decideFailure({ attemptCount: 3 }, retryableErr());
    expect(d.action).toBe("reschedule");
    if (d.action !== "reschedule") return;
    expect(d.delayMs).toBe(2 * 60 * 60_000);
  });

  it("attempt 5 retryable failure → 12h delay (last reschedule)", () => {
    const d = decideFailure({ attemptCount: 4 }, retryableErr());
    expect(d.action).toBe("reschedule");
    if (d.action !== "reschedule") return;
    expect(d.delayMs).toBe(12 * 60 * 60_000);
  });

  it("attempt 6 retryable failure → terminal failed (cap reached)", () => {
    const d = decideFailure({ attemptCount: 5 }, retryableErr());
    expect(d.action).toBe("fail");
  });

  it("retryAfterMs overrides the configured backoff interval", () => {
    const d = decideFailure({ attemptCount: 0 }, retryableErr(42_000));
    expect(d.action).toBe("reschedule");
    if (d.action !== "reschedule") return;
    expect(d.delayMs).toBe(42_000);
  });

  it("retryAfterMs above 24h is capped to 24h", () => {
    const beyond24h = 25 * 60 * 60_000;
    expect(pickRetryDelayMs(1, beyond24h)).toBe(24 * 60 * 60_000);
    expect(pickRetryDelayMs(1, 24 * 60 * 60_000)).toBe(24 * 60 * 60_000); // exactly at cap
  });

  it("retryable: false → terminal failed regardless of attempt count", () => {
    const err = pluginError("plugin.bad_credentials", "bad", { retryable: false });
    expect(decideFailure({ attemptCount: 0 }, err).action).toBe("fail");
    expect(decideFailure({ attemptCount: 3 }, err).action).toBe("fail");
  });

  it("plain error on first attempt → defensive retry once", () => {
    const d = decideFailure({ attemptCount: 0 }, new Error("oops"));
    expect(d.action).toBe("reschedule");
  });

  it("plain error on second attempt → terminal failed (defensive default exhausted)", () => {
    const d = decideFailure({ attemptCount: 1 }, new Error("oops"));
    expect(d.action).toBe("fail");
  });

  it("forwards the plugin error code into the persisted failure metadata", () => {
    const err = pluginError("plugin.rate_limited", "slow down", {
      retryable: true,
      retryAfterMs: 1_000,
    });
    const d = decideFailure({ attemptCount: 0 }, err);
    if (d.action !== "reschedule") throw new Error("expected reschedule");
    expect(d.errorCode).toBe("plugin.rate_limited");
    expect(d.errorMessage).toBe("slow down");
  });
});

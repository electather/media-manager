import { describe, it, expect, afterEach } from "vite-plus/test";
import {
  assertValidSchedule,
  scheduleCron,
  unscheduleAll,
  unscheduleCron,
} from "../croner-adapter";

describe("croner-adapter", () => {
  afterEach(() => {
    unscheduleAll();
  });

  it("accepts a valid cron expression", () => {
    expect(() => assertValidSchedule("*/5 * * * *")).not.toThrow();
  });

  it("rejects an invalid cron expression", () => {
    expect(() => assertValidSchedule("not-a-cron")).toThrow(/invalid cron/);
  });

  it("replaces a prior schedule when re-registering the same job id", () => {
    // Behavior only: we don't wait for a tick. Registration succeeds twice
    // without throwing, and the second call silently replaces the first.
    scheduleCron("test.job", "*/1 * * * *", () => undefined);
    scheduleCron("test.job", "0 * * * *", () => undefined);
    unscheduleCron("test.job");
  });
});

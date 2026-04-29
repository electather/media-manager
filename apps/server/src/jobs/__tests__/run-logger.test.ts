import { describe, expect, it, vi } from "vite-plus/test";
import { createRunLogger, runWithLogCapture, serializeRunLogs } from "../run-logger";

interface CapturedEntry {
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  meta?: Record<string, unknown>;
}

async function captureWith(fn: () => void): Promise<CapturedEntry[]> {
  return runWithLogCapture("debug", async () => {
    fn();
    const { logs } = serializeRunLogs();
    return logs ? (JSON.parse(logs) as CapturedEntry[]) : [];
  });
}

describe("createRunLogger ring-buffer capture", () => {
  it("captures success / fail / ready / start / box alongside the standard levels", async () => {
    const logger = createRunLogger("test-job", "1234567890abcdef", "abcdef1234567890");
    const entries = await captureWith(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.success("s", { extra: 1 });
      logger.fail("f");
      logger.ready("r");
      logger.start("st");
    });

    const byMsg = Object.fromEntries(entries.map((entry) => [entry.msg, entry]));
    expect(byMsg.s?.level).toBe("info");
    expect(byMsg.s?.meta).toEqual({ extra: 1 });
    expect(byMsg.f?.level).toBe("error");
    expect(byMsg.r?.level).toBe("info");
    expect(byMsg.st?.level).toBe("info");
    // Sanity-check the existing levels still flow.
    expect(byMsg.d?.level).toBe("debug");
    expect(byMsg.w?.level).toBe("warn");
    expect(byMsg.e?.level).toBe("error");
  });

  it("buffers verbose types but skips stdout for anything above the threshold (default warn)", async () => {
    // Default threshold is `warn` (verbosity 1). `success` (3) and `info` (3)
    // sit above that and must drop from stdout while still landing in the
    // buffer; `warn` (1) and `error` (0) print as usual.
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const logger = createRunLogger("test-job", "ffffffff00000000", "ffffffff11111111");
      const entries = await captureWith(() => {
        logger.success("buffered-but-silent");
        logger.info("info-also-silent");
        logger.warn("buffered-and-loud");
      });

      expect(entries.map((entry) => entry.msg)).toEqual([
        "buffered-but-silent",
        "info-also-silent",
        "buffered-and-loud",
      ]);
      const allWrites = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls]
        .map((call) => String(call[0]))
        .join("\n");
      expect(allWrites).not.toContain("buffered-but-silent");
      expect(allWrites).not.toContain("info-also-silent");
      expect(allWrites).toContain("buffered-and-loud");
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("propagates structured meta from the second arg", async () => {
    const logger = createRunLogger("test-job", "00000000aaaaaaaa", "00000000bbbbbbbb");
    const entries = await captureWith(() => {
      logger.success("Completed", { userId: "u1", durationMs: 42 });
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe("Completed");
    expect(entries[0]?.meta).toEqual({ userId: "u1", durationMs: 42 });
  });
});

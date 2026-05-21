import { describe, it, expect } from "vite-plus/test";
import { parseRetryAfterSec } from "../src/client";

describe("parseRetryAfterSec", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfterSec("120")).toBe(120);
  });

  it("falls back to the 60 s default when header is absent", () => {
    expect(parseRetryAfterSec(null)).toBe(60);
  });

  it("falls back to the 60 s default for HTTP-date headers (intentional, not parsed)", () => {
    // Fanart returns either an integer second count or a date; we honour the
    // integer form only — the default keeps the pool moving instead of
    // stalling on a date we can't reason about.
    expect(parseRetryAfterSec("Fri, 01 Jan 2027 00:00:00 GMT")).toBe(60);
  });

  it("falls back to the 60 s default for zero or negative values", () => {
    expect(parseRetryAfterSec("0")).toBe(60);
    expect(parseRetryAfterSec("-30")).toBe(60);
  });

  it("floors fractional seconds", () => {
    expect(parseRetryAfterSec("5.9")).toBe(5);
  });
});

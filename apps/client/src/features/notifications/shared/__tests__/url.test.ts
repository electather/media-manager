// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import { isSafeActionUrl } from "../url";

describe("isSafeActionUrl", () => {
  it("allows http: URLs", () => {
    expect(isSafeActionUrl("http://example.com/path")).toBe(true);
  });

  it("allows https: URLs", () => {
    expect(isSafeActionUrl("https://example.com/path")).toBe(true);
  });

  it("blocks javascript: URLs", () => {
    expect(isSafeActionUrl("javascript:alert(1)")).toBe(false);
  });

  it("blocks data: URLs", () => {
    expect(isSafeActionUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("blocks vbscript: URLs", () => {
    expect(isSafeActionUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("allows relative URLs (resolved to http/https via origin)", () => {
    expect(isSafeActionUrl("/some/path")).toBe(true);
  });
});

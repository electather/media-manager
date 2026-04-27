import { describe, it, expect } from "vite-plus/test";
import { LibraryAdminV1 } from "../library-admin";
import { getCapability } from "../index";

describe("LibraryAdminV1", () => {
  it("registers as a user-scoped aggregate capability at v1", () => {
    expect(LibraryAdminV1.version).toBe("v1");
    expect(LibraryAdminV1.scope).toBe("user");
    expect(getCapability("libraryAdmin", "v1")).toBe(LibraryAdminV1);
  });

  it("exposes refreshLibrary and refreshItem", () => {
    expect(Object.keys(LibraryAdminV1.methods).sort()).toEqual(
      ["refreshItem", "refreshLibrary"].sort(),
    );
  });

  describe("refreshLibrary", () => {
    it("accepts no input", () => {
      const r = LibraryAdminV1.methods.refreshLibrary.input.safeParse({});
      expect(r.success).toBe(true);
    });

    it("accepts an optional librarySectionId", () => {
      const r = LibraryAdminV1.methods.refreshLibrary.input.safeParse({
        librarySectionId: "section-3",
      });
      expect(r.success).toBe(true);
    });

    it("returns { ok }", () => {
      const r = LibraryAdminV1.methods.refreshLibrary.output.safeParse({ ok: true });
      expect(r.success).toBe(true);
    });

    it("does not invalidate other capabilities (fire-and-forget)", () => {
      expect(LibraryAdminV1.methods.refreshLibrary.invalidates).toBeUndefined();
    });
  });

  describe("refreshItem", () => {
    it("requires a serverItemId", () => {
      const r = LibraryAdminV1.methods.refreshItem.input.safeParse({});
      expect(r.success).toBe(false);
    });

    it("rejects an empty serverItemId", () => {
      const r = LibraryAdminV1.methods.refreshItem.input.safeParse({ serverItemId: "" });
      expect(r.success).toBe(false);
    });

    it("accepts a valid serverItemId", () => {
      const r = LibraryAdminV1.methods.refreshItem.input.safeParse({ serverItemId: "12345" });
      expect(r.success).toBe(true);
    });

    it("does not invalidate other capabilities (fire-and-forget)", () => {
      expect(LibraryAdminV1.methods.refreshItem.invalidates).toBeUndefined();
    });
  });
});

import { describe, it, expect } from "vite-plus/test";
import { MediaRequestV1 } from "../media-request";

describe("MediaRequestV1 capability", () => {
  describe("listTargets", () => {
    it("accepts movie type", () => {
      const r = MediaRequestV1.methods.listTargets.input.safeParse({ type: "movie" });
      expect(r.success).toBe(true);
    });

    it("accepts tv type", () => {
      const r = MediaRequestV1.methods.listTargets.input.safeParse({ type: "tv" });
      expect(r.success).toBe(true);
    });

    it("rejects unknown type", () => {
      const r = MediaRequestV1.methods.listTargets.input.safeParse({ type: "music" });
      expect(r.success).toBe(false);
    });

    it("accepts a target with profiles", () => {
      const r = MediaRequestV1.methods.listTargets.output.safeParse({
        targets: [
          {
            targetId: "1",
            label: "Radarr",
            exposesProfiles: true,
            defaultProfileId: "5",
            profiles: [{ id: "5", label: "1080p" }],
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejects a target with an illegal targetId (contains colon)", () => {
      const r = MediaRequestV1.methods.listTargets.output.safeParse({
        targets: [
          {
            targetId: "bad:id",
            label: "Radarr",
            exposesProfiles: false,
            defaultProfileId: null,
            profiles: [],
          },
        ],
      });
      expect(r.success).toBe(false);
    });

    it("accepts a target with no profiles and null default", () => {
      const r = MediaRequestV1.methods.listTargets.output.safeParse({
        targets: [
          {
            targetId: "abc-123_x",
            label: "Sonarr",
            exposesProfiles: false,
            defaultProfileId: null,
            profiles: [],
          },
        ],
      });
      expect(r.success).toBe(true);
    });
  });

  describe("createRequest input", () => {
    it("accepts new optional targetId and profileId fields", () => {
      const r = MediaRequestV1.methods.createRequest.input.safeParse({
        tmdbId: "1",
        type: "movie",
        targetId: "1",
        profileId: "5",
      });
      expect(r.success).toBe(true);
    });

    it("still accepts the legacy shape without target/profile", () => {
      const r = MediaRequestV1.methods.createRequest.input.safeParse({
        tmdbId: "1",
        type: "tv",
        seasons: "1,2",
      });
      expect(r.success).toBe(true);
    });
  });
});

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

  describe("listRequests output", () => {
    it("accepts row with seasons[], targetLabel, profileLabel", () => {
      const r = MediaRequestV1.methods.listRequests.output.safeParse([
        {
          id: "1",
          tmdbId: "550",
          type: "movie",
          title: "Fight Club",
          status: "pending",
          createdAt: "2026-01-01T00:00:00Z",
          seasons: [],
          targetLabel: "Radarr Main",
          profileLabel: "1080p",
        },
      ]);
      expect(r.success).toBe(true);
    });

    it("accepts null targetLabel and profileLabel", () => {
      const r = MediaRequestV1.methods.listRequests.output.safeParse([
        {
          id: "2",
          tmdbId: "1396",
          type: "tv",
          title: "Breaking Bad",
          status: "approved",
          createdAt: "2026-01-01T00:00:00Z",
          seasons: [1, 2],
          targetLabel: null,
          profileLabel: null,
        },
      ]);
      expect(r.success).toBe(true);
    });

    it("defaults seasons to [] when omitted (movie rows / Jellyseerr renames)", () => {
      const r = MediaRequestV1.methods.listRequests.output.safeParse([
        {
          id: "3",
          tmdbId: "1",
          type: "movie",
          title: "x",
          status: "pending",
          createdAt: "2026-01-01T00:00:00Z",
          targetLabel: null,
          profileLabel: null,
        },
      ]);
      expect(r.success).toBe(true);
      expect(r.data?.[0]?.seasons).toEqual([]);
    });

    it("defaults targetLabel/profileLabel to null when omitted", () => {
      const r = MediaRequestV1.methods.listRequests.output.safeParse([
        {
          id: "4",
          tmdbId: "550",
          type: "movie",
          title: "Fight Club",
          status: "pending",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]);
      expect(r.success).toBe(true);
      expect(r.data?.[0]?.seasons).toEqual([]);
      expect(r.data?.[0]?.targetLabel).toBeNull();
      expect(r.data?.[0]?.profileLabel).toBeNull();
    });
  });
});

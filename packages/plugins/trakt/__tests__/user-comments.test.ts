import { describe, it, expect } from "vite-plus/test";
import { UserCommentsV1 } from "@nama/plugin-sdk";
import { makeCtx, paginatedPage, MOVIE } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.userComments!;

describe("userComments", () => {
  it("getComments: paginates /users/me/comments", async () => {
    const ctx = makeCtx([
      paginatedPage([
        { type: "movie", comment: { text: "great", created_at: "2026-04-01" }, movie: MOVIE },
      ]),
    ]);
    const out = await cap.getComments!(ctx, {});
    expect(ctx.calls[0]?.url).toContain("/users/me/comments");
    expect(UserCommentsV1.methods.getComments.output.safeParse(out).success).toBe(true);
  });
});

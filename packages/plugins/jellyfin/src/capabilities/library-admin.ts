import type { Ctx } from "../types";
import { jellyfinFireAndForget } from "../client";

export const libraryAdmin = {
  async refreshLibrary(ctx: unknown, _input: unknown) {
    return jellyfinFireAndForget(ctx as Ctx, `/Library/Refresh`);
  },

  async refreshItem(ctx: unknown, input: unknown) {
    const { serverItemId } = input as { serverItemId: string };
    return jellyfinFireAndForget(ctx as Ctx, `/Items/${serverItemId}/Refresh`);
  },
};

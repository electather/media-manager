import type { Ctx } from "../types";
import { jellyfinFireAndForget } from "../client";

export const libraryAdmin = {
  async refreshLibrary(ctx: unknown, _input: unknown) {
    // Jellyfin only exposes a server-wide refresh; per-section is not
    // a first-class endpoint. `/Library/Refresh` kicks all libraries,
    // which matches the contract's "plugin refreshes all sections it
    // can see".
    return jellyfinFireAndForget(ctx as Ctx, `/Library/Refresh`);
  },

  async refreshItem(ctx: unknown, input: unknown) {
    const { serverItemId } = input as { serverItemId: string };
    return jellyfinFireAndForget(ctx as Ctx, `/Items/${serverItemId}/Refresh`);
  },
};

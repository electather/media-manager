import { useCommandMenuMedia } from "@/shared/components/command-menu-media-provider";

/**
 * Thin alias around `useCommandMenuMedia` so the rest of the command-menu
 * module imports from a single seam. The provider is filled in at the route
 * layer (`_authenticated/_app/route.tsx`) where feature data is available.
 */
export function useMediaPool() {
  return useCommandMenuMedia();
}

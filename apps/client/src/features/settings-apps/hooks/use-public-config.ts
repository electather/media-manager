// Re-export the canonical hook from settings so settings-apps reads from the
// shared cache key rather than maintaining a duplicate entry under its own key.
export { usePublicConfig } from "@/features/settings";

import { createFileRoute } from "@tanstack/react-router";
import { HomeFeed } from "@/features/home";
import { peekSchema } from "@/lib/home-display";

export const Route = createFileRoute("/_authenticated/_app/")({
  validateSearch: peekSchema,
  component: HomeFeed,
});

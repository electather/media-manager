import { createFileRoute } from "@tanstack/react-router";
import { HomeFeed } from "@/features/home";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomeFeed,
});

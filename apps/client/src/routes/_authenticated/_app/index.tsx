import { createFileRoute } from "@tanstack/react-router";
import { HomeFeed } from "@/components/home/home-feed";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomePage,
});

function HomePage() {
  return <HomeFeed />;
}

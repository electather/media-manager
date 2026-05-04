import { invariant } from "es-toolkit/util";
import { useHomeFeed } from "../hooks/use-home-feed";

export function HomeFeed() {
  const data = useHomeFeed();
  invariant(data.hero !== null, "home feed requires a hero item");
  return <div>Home feed coming soon</div>;
}

import { Button } from "@/components/ui/button";
import { CenteredState } from "./centered-state";

export function HomeFeedError({ onRetry }: { onRetry: () => void }) {
  return (
    <CenteredState
      title="Couldn't load your home feed."
      body="Something went wrong. Give it a moment and try again."
      action={<Button onClick={onRetry}>Retry</Button>}
    />
  );
}

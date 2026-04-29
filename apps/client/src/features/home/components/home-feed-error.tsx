import { CenteredState } from "./centered-state";

interface HomeFeedErrorProps {
  onRetry: () => void;
}

export function HomeFeedError({ onRetry }: HomeFeedErrorProps) {
  return (
    <CenteredState
      title="Couldn't load your home feed."
      body="Something went wrong. Give it a moment and try again."
      action={{ label: "Retry", onClick: onRetry }}
    />
  );
}

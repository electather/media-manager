import { useNavigate } from "@tanstack/react-router";

import { CenteredState } from "./centered-state";

export function HomeFeedEmpty() {
  const navigate = useNavigate();
  return (
    <CenteredState
      title="Nothing to show yet."
      body="Connect a service to start seeing your media."
      action={{
        label: "Connect a service →",
        onClick: () => void navigate({ to: "/settings/connections" }),
      }}
    />
  );
}

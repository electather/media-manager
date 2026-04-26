import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CenteredState } from "./centered-state";

export function HomeFeedEmpty() {
  const navigate = useNavigate();
  return (
    <CenteredState
      title="Nothing to show yet."
      body="Connect a service to start seeing your media."
      action={
        <Button onClick={() => void navigate({ to: "/settings/connections" })}>
          Connect a service
          <ArrowRightIcon className="ml-1 size-4" />
        </Button>
      }
    />
  );
}

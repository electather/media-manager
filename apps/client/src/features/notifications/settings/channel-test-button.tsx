import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";
import { useTestChannel } from "./use-test-channel";

export function ChannelTestButton({ connectionId }: { connectionId: string }) {
  const test = useTestChannel();
  const Icon = test.isPending
    ? LoaderCircleIcon
    : test.isSuccess
      ? CheckIcon
      : test.isError
        ? XIcon
        : null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => test.mutate(connectionId)}
      disabled={test.isPending}
    >
      {Icon && <Icon className={`size-4 ${test.isPending ? "animate-spin" : ""}`} />}
      {m.notifications_settings_test_button()}
    </Button>
  );
}

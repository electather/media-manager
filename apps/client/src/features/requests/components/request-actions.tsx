import { DownloadIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { RequestRole, RequestableItem } from "../lib/types";

interface RequestActionsProps {
  item: RequestableItem;
  role: RequestRole;
  defaultServiceId: string;
  defaultProfileId: string;
  pluginConfigured: boolean;
  onSubmit: () => void;
}

export function RequestActions({ pluginConfigured, onSubmit }: RequestActionsProps) {
  return (
    <Button onClick={onSubmit} disabled={!pluginConfigured} className="gap-2">
      <DownloadIcon className="size-4" />
      Request
    </Button>
  );
}

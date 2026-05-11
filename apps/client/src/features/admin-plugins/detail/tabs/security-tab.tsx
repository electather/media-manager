import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Separator } from "@/shared/ui/separator";

import { AllowlistPanel } from "../security/allowlist-panel";
import { HeadersPanel } from "../security/headers-panel";
import type { PluginRow } from "../../shared/types";

interface SecurityTabProps {
  plugin: PluginRow;
}

export function SecurityTab({ plugin }: SecurityTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Network policy</CardTitle>
        <CardDescription>
          Restrict the hosts this plugin can reach and inject extra headers into every outbound
          request. Enforced by the plugin runtime at the fetch boundary.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <AllowlistPanel plugin={plugin} />
        <Separator />
        <HeadersPanel plugin={plugin} />
      </CardContent>
    </Card>
  );
}

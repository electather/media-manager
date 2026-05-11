import { m } from "@/paraglide/messages";

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
        <CardTitle>{m.admin_plugins_security_title()}</CardTitle>
        <CardDescription>{m.admin_plugins_security_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <AllowlistPanel plugin={plugin} />
        <Separator />
        <HeadersPanel plugin={plugin} />
      </CardContent>
    </Card>
  );
}

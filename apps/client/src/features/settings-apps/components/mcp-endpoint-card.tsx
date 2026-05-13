import { InfoIcon, MoreHorizontalIcon, PlugIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/components/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { m } from "@/paraglide/messages";
import { SettingsCard } from "@/features/settings/components/settings-card";

import { MetaSep } from "./meta-sep";
import { ScopeChip } from "./scope-chip";

interface McpEndpointCardProps {
  endpointUrl: string;
  scopes: ReadonlyArray<string>;
  clientCount: number;
  onShowSetupGuide: () => void;
}

export function McpEndpointCard({
  endpointUrl,
  scopes,
  clientCount,
  onShowSetupGuide,
}: McpEndpointCardProps) {
  return (
    <SettingsCard>
      <McpEndpointHeader onShowSetupGuide={onShowSetupGuide} />
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <McpEndpointUrl url={endpointUrl} />
        <McpEndpointMeta clientCount={clientCount} />
        <McpEndpointScopeSummary scopes={scopes} />
      </div>
    </SettingsCard>
  );
}

function McpEndpointHeader({ onShowSetupGuide }: { onShowSetupGuide: () => void }) {
  return (
    <div className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">
          {m.settings_apps_endpoint_label()}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {m.settings_apps_endpoint_description()}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.settings_apps_endpoint_action_more()}
              data-testid="endpoint-actions"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onShowSetupGuide} data-testid="open-setup-guide">
            <InfoIcon className="size-3.5" />
            {m.settings_apps_endpoint_setup_guide()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function McpEndpointUrl({ url }: { url: string }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center border-e border-border px-3.5 text-muted-foreground">
        <PlugIcon className="size-3.5" aria-hidden="true" />
      </div>
      <div
        className="min-w-0 flex-1 truncate px-3.5 py-3 font-mono text-[13px] text-foreground"
        title={url}
      >
        {url}
      </div>
      <CopyButton
        value={url}
        label={m.settings_apps_endpoint_copy_short()}
        copiedLabel={m.settings_apps_endpoint_copied()}
        aria-label={m.settings_apps_endpoint_copy()}
        title={m.settings_apps_endpoint_copy()}
        data-testid="copy-endpoint"
        className="h-auto shrink-0 gap-1.5 rounded-none border-0 border-s border-border bg-muted px-3.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
        iconClassName="size-3.5"
      />
    </div>
  );
}

function McpEndpointMeta({ clientCount }: { clientCount: number }) {
  const clientLabel =
    clientCount === 1
      ? m.settings_apps_endpoint_clients_singular({ count: clientCount })
      : m.settings_apps_endpoint_clients_plural({ count: clientCount });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
        {m.settings_apps_endpoint_status_live()}
      </span>
      <MetaSep />
      <span>{clientLabel}</span>
    </div>
  );
}

function McpEndpointScopeSummary({ scopes }: { scopes: ReadonlyArray<string> }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-3.5 py-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
      >
        <ShieldCheckIcon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {m.settings_apps_endpoint_scope_summary()}
        </p>
        <div className="flex flex-wrap gap-1">
          {scopes.map((scope) => (
            <ScopeChip key={scope} scope={scope} />
          ))}
        </div>
      </div>
    </div>
  );
}

import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { CapabilityBadges } from "@/shared/lib/capabilities";
import { cn } from "@/shared/lib/utils";

import { StatusDot } from "../../shared/status-dot";
import type { PluginRow } from "../../shared/types";
import { pluginPurity } from "../../shared/types";

interface OverviewTabProps {
  plugin: PluginRow;
  onChangeFallback: (next: PersonalKeyFallbackPolicy) => void;
  fallbackPending: boolean;
}

const POLICIES: ReadonlyArray<{
  id: PersonalKeyFallbackPolicy;
  label: string;
  desc: string;
}> = [
  {
    id: "off",
    label: "Off",
    desc: "Admin and user keys stay separate. User-scoped calls use the user's own keys only.",
  },
  {
    id: "admin-first",
    label: "Admin first",
    desc: "Try shared credentials first; fall back to the user's personal connection when exhausted.",
  },
  {
    id: "personal-first",
    label: "Personal first",
    desc: "Try the user's connection first; fall back to shared credentials if it fails or is missing.",
  },
];

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "disabled";
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3.5 py-2.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </div>
      <div className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-foreground">
        {tone ? <StatusDot tone={tone} size={7} /> : null}
        {value}
      </div>
    </div>
  );
}

function KVRow({ k, v, last }: { k: string; v: React.ReactNode; last?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[140px_1fr] gap-4 py-2 text-sm",
        !last && "border-b border-border",
      )}
    >
      <div className="text-muted-foreground">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}

// fallow-ignore-next-line complexity
export function OverviewTab({ plugin, onChangeFallback, fallbackPending }: OverviewTabProps) {
  const userCaps = plugin.capabilities.filter((c) => c.scope === "user");
  const globalCaps = plugin.capabilities.filter((c) => c.scope === "global");
  const hasShared = Boolean(plugin.manifest.sharedCredentialsSchema);
  const purity = pluginPurity(plugin);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCell
          label="Status"
          value={plugin.enabled ? "Enabled" : "Disabled"}
          tone={plugin.enabled ? "ok" : "disabled"}
        />
        <StatCell
          label="Shared keys"
          value={
            hasShared
              ? `${plugin.sharedCredentialsEnabledCount} / ${plugin.sharedCredentialsCount}`
              : "—"
          }
        />
        <StatCell label="Capabilities" value={String(plugin.capabilities.length)} />
        <StatCell
          label="Scope"
          value={
            purity === "user" ? "User-scoped" : purity === "global" ? "Metadata-only" : "Mixed"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>
            What this plugin can do. Global capabilities work without any connection. User
            capabilities require each user to connect their own account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {globalCaps.length > 0 ? (
            <div>
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
                Global
              </div>
              <CapabilityBadges
                entries={globalCaps.map((c) => ({ id: c.id, version: c.version }))}
                size="sm"
              />
            </div>
          ) : null}
          {userCaps.length > 0 ? (
            <div>
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
                Per-user
              </div>
              <CapabilityBadges
                entries={userCaps.map((c) => ({ id: c.id, version: c.version }))}
                size="sm"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {userCaps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Personal-key fallback policy</CardTitle>
            <CardDescription>
              When a user's request needs a {plugin.manifest.name} call, which credentials does the
              server try?
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <RadioGroup
              value={plugin.personalKeyFallback}
              onValueChange={(value) => onChangeFallback(value as PersonalKeyFallbackPolicy)}
              aria-label="Personal-key fallback policy"
              className="flex flex-col gap-1"
            >
              {POLICIES.map((p) => {
                const optionDisabled = p.id !== "off" && !plugin.isPureGlobal && !hasShared;
                return (
                  <Radio.Root
                    key={p.id}
                    value={p.id}
                    disabled={optionDisabled || fallbackPending}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      "border-transparent hover:bg-muted/60",
                      "data-[checked]:border-border data-[checked]:bg-muted",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <Radio.Indicator
                      className={cn(
                        "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                        "border-border data-[checked]:border-primary",
                      )}
                    >
                      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                    </Radio.Indicator>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{p.desc}</span>
                    </span>
                  </Radio.Root>
                );
              })}
            </RadioGroup>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent>
          <KVRow k="Plugin ID" v={<code className="font-mono">{plugin.id}</code>} />
          {plugin.manifest.author ? <KVRow k="Vendor" v={plugin.manifest.author.name} /> : null}
          <KVRow k="Version" v={<code className="font-mono">{plugin.version}</code>} />
          <KVRow k="Source" v={plugin.isBuiltin ? "Built-in" : plugin.sourceType} />
          <KVRow k="Installed" v={new Date(plugin.installedAt).toLocaleString()} />
          <KVRow
            k="Pool eligible"
            v={
              plugin.poolable ? (
                <Badge variant="secondary" className="text-xs font-normal">
                  Yes
                </Badge>
              ) : (
                "No"
              )
            }
            last
          />
        </CardContent>
      </Card>
    </div>
  );
}

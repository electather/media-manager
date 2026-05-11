import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { m } from "@/paraglide/messages";

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

function getPolicies() {
  return [
    {
      id: "off" as PersonalKeyFallbackPolicy,
      label: m.admin_plugins_overview_policy_off_label(),
      desc: m.admin_plugins_overview_policy_off_desc(),
    },
    {
      id: "admin-first" as PersonalKeyFallbackPolicy,
      label: m.admin_plugins_overview_policy_admin_first_label(),
      desc: m.admin_plugins_overview_policy_admin_first_desc(),
    },
    {
      id: "personal-first" as PersonalKeyFallbackPolicy,
      label: m.admin_plugins_overview_policy_personal_first_label(),
      desc: m.admin_plugins_overview_policy_personal_first_desc(),
    },
  ];
}

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

  const scopeLabel =
    purity === "user"
      ? m.admin_plugins_overview_scope_user()
      : purity === "global"
        ? m.admin_plugins_overview_scope_global()
        : m.admin_plugins_overview_scope_mixed();

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCell
          label={m.admin_plugins_overview_stat_status()}
          value={
            plugin.enabled
              ? m.admin_plugins_overview_stat_enabled()
              : m.admin_plugins_overview_stat_disabled()
          }
          tone={plugin.enabled ? "ok" : "disabled"}
        />
        <StatCell
          label={m.admin_plugins_overview_stat_shared_keys()}
          value={
            hasShared
              ? `${plugin.sharedCredentialsEnabledCount} / ${plugin.sharedCredentialsCount}`
              : "—"
          }
        />
        <StatCell
          label={m.admin_plugins_overview_stat_capabilities()}
          value={String(plugin.capabilities.length)}
        />
        <StatCell label={m.admin_plugins_overview_stat_scope()} value={scopeLabel} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m.admin_plugins_overview_caps_title()}</CardTitle>
          <CardDescription>{m.admin_plugins_overview_caps_description()}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {globalCaps.length > 0 ? (
            <div>
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
                {m.admin_plugins_overview_caps_global()}
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
                {m.admin_plugins_overview_caps_user()}
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
            <CardTitle>{m.admin_plugins_overview_fallback_title()}</CardTitle>
            <CardDescription>
              {m.admin_plugins_overview_fallback_description({ name: plugin.manifest.name })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <RadioGroup
              value={plugin.personalKeyFallback}
              onValueChange={(value) => onChangeFallback(value as PersonalKeyFallbackPolicy)}
              aria-label={m.admin_plugins_overview_fallback_aria()}
              className="flex flex-col gap-1"
            >
              {getPolicies().map((p) => {
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
          <CardTitle>{m.admin_plugins_overview_identity_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <KVRow
            k={m.admin_plugins_overview_identity_id()}
            v={<code className="font-mono">{plugin.id}</code>}
          />
          {plugin.manifest.author ? (
            <KVRow k={m.admin_plugins_overview_identity_vendor()} v={plugin.manifest.author.name} />
          ) : null}
          <KVRow
            k={m.admin_plugins_overview_identity_version()}
            v={<code className="font-mono">{plugin.version}</code>}
          />
          <KVRow
            k={m.admin_plugins_overview_identity_source()}
            v={
              plugin.isBuiltin
                ? m.admin_plugins_overview_identity_source_builtin()
                : plugin.sourceType
            }
          />
          <KVRow
            k={m.admin_plugins_overview_identity_installed()}
            v={new Date(plugin.installedAt).toLocaleString()}
          />
          <KVRow
            k={m.admin_plugins_overview_identity_pool_eligible()}
            v={
              plugin.poolable ? (
                <Badge variant="secondary" className="text-xs font-normal">
                  {m.admin_plugins_overview_identity_pool_yes()}
                </Badge>
              ) : (
                m.admin_plugins_overview_identity_pool_no()
              )
            }
            last
          />
        </CardContent>
      </Card>
    </div>
  );
}

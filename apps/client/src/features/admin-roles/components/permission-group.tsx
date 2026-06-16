import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Switch } from "@/shared/ui/switch";

import { m } from "@/paraglide/messages";
import type { PermissionGroupDef } from "../lib/permission-tree";

interface Props {
  group: PermissionGroupDef;
  granted: ReadonlySet<string>;
  readOnly: boolean;
  onTogglePermission: (key: string, on: boolean) => void;
  onToggleScope: (scope: PermissionGroupDef["scope"], on: boolean) => void;
}

export function PermissionGroup({
  group,
  granted,
  readOnly,
  onTogglePermission,
  onToggleScope,
}: Props) {
  const keys = group.permissions.map((p) => p.key);
  const grantedCount = keys.filter((k) => granted.has(k)).length;
  const allOn = grantedCount === keys.length;
  const noneOn = grantedCount === 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{group.label()}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {group.scope}:*
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{group.description()}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {grantedCount}/{keys.length}
          </span>
          <RadioGroup
            value={allOn ? "all" : noneOn ? "none" : "partial"}
            onValueChange={(v) => onToggleScope(group.scope, v === "all")}
            aria-label={m.admin_roles_perm_group_scope_aria({ scope: group.label() })}
            disabled={readOnly}
          >
            <RadioGroupItem value="none">{m.admin_roles_perm_group_none()}</RadioGroupItem>
            <RadioGroupItem value="all">{m.admin_roles_perm_group_all()}</RadioGroupItem>
          </RadioGroup>
        </div>
      </header>
      <ul className="divide-y divide-border">
        {group.permissions.map((p) => {
          const on = granted.has(p.key);
          return (
            <li
              key={p.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{p.label()}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/80">{p.key}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.description()}</p>
              </div>
              <Switch
                checked={on}
                disabled={readOnly}
                onCheckedChange={(v) => onTogglePermission(p.key, v)}
                aria-label={m.admin_roles_perm_grant_aria({ key: p.key })}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

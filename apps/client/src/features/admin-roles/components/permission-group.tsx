import { Switch } from "@/shared/ui/switch";
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
  const someOn = grantedCount > 0 && !allOn;

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
          <Switch
            checked={allOn}
            data-state={someOn ? "indeterminate" : undefined}
            disabled={readOnly}
            onCheckedChange={(v) => onToggleScope(group.scope, v)}
            aria-label={`Toggle all ${group.label()} permissions`}
          />
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
                aria-label={`Grant ${p.key}`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

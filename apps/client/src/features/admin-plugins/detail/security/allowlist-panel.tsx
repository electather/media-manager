import { useEffect, useState } from "react";
import { LoaderCircleIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { PLUGIN_ADMIN_ALLOWLIST_MAX } from "@ent-mcp/shared/plugins";

import { m } from "@/paraglide/messages";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Label } from "@/shared/ui/label";

import { useUpdateAllowlist } from "../use-update-allowlist";
import type { PluginRow } from "../../shared/types";

const HOST_PATTERN =
  /^(?:\*|(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;

interface AllowlistPanelProps {
  plugin: PluginRow;
}

// Returns true when two host patterns can both match the same hostname — used to detect
// when the admin allowlist would block all traffic the manifest declared.
// fallow-ignore-next-line complexity
function patternsOverlap(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === "*" || lb === "*") return true;
  if (la === lb) return true;
  const aWild = la.startsWith("*.");
  const bWild = lb.startsWith("*.");
  if (aWild && !bWild) {
    const suffix = la.slice(1);
    return lb.endsWith(suffix) && lb.length > suffix.length;
  }
  if (bWild && !aWild) {
    const suffix = lb.slice(1);
    return la.endsWith(suffix) && la.length > suffix.length;
  }
  if (aWild && bWild) {
    const aSuffix = la.slice(1);
    const bSuffix = lb.slice(1);
    return aSuffix.endsWith(bSuffix) || bSuffix.endsWith(aSuffix);
  }
  return false;
}

// fallow-ignore-next-line complexity
export function AllowlistPanel({ plugin }: AllowlistPanelProps) {
  const manifestHosts = plugin.manifest.allowedHosts ?? [];
  const stored = plugin.advanced.adminAllowlist;
  const [mode, setMode] = useState<"inherit" | "restrict">(
    stored === null ? "inherit" : "restrict",
  );
  const [entries, setEntries] = useState<string[]>(stored ?? []);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const update = useUpdateAllowlist(plugin.id);

  // Serialize to avoid re-syncing when the array reference changes but contents are identical.
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    setMode(stored === null ? "inherit" : "restrict");
    setEntries(stored ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  // fallow-ignore-next-line complexity
  const addEntry = () => {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) return;
    if (!HOST_PATTERN.test(normalized)) {
      setDraftError(m.admin_plugins_allowlist_error_pattern());
      return;
    }
    if (entries.includes(normalized)) {
      setDraftError(m.admin_plugins_allowlist_error_duplicate());
      return;
    }
    if (entries.length >= PLUGIN_ADMIN_ALLOWLIST_MAX) {
      setDraftError(m.admin_plugins_allowlist_error_max({ max: PLUGIN_ADMIN_ALLOWLIST_MAX }));
      return;
    }
    setEntries([...entries, normalized]);
    setDraft("");
    setDraftError(null);
  };

  const intersectionEmpty =
    mode === "restrict" &&
    (entries.length === 0 ||
      (manifestHosts.length > 0 &&
        !entries.some((a) => manifestHosts.some((b) => patternsOverlap(a, b)))));

  const save = () => {
    update.mutate(mode === "inherit" ? null : entries);
  };

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="text-sm font-medium">{m.admin_plugins_allowlist_title()}</h3>
        <p className="text-xs text-muted-foreground">
          {m.admin_plugins_allowlist_description({ name: plugin.manifest.name })}
        </p>
      </header>

      {manifestHosts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
            {m.admin_plugins_allowlist_declared_label()}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {manifestHosts.map((h) => (
              <Badge key={h} variant="secondary" className="font-mono text-xs font-normal">
                {h}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <RadioGroup
        value={mode}
        onValueChange={(value) => setMode(value as "inherit" | "restrict")}
        className="gap-1.5"
      >
        <Label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
          <RadioGroupItem value="inherit" className="mt-0.5" />
          <span>{m.admin_plugins_allowlist_mode_inherit()}</span>
        </Label>
        <Label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
          <RadioGroupItem value="restrict" className="mt-0.5" />
          <span>{m.admin_plugins_allowlist_mode_restrict()}</span>
        </Label>
      </RadioGroup>

      {mode === "restrict" ? (
        <div className="ml-6 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {entries.map((entry) => (
              <Badge
                key={entry}
                variant="outline"
                className="gap-1 pr-1 font-mono text-xs font-normal"
              >
                {entry}
                <button
                  type="button"
                  aria-label={m.admin_plugins_allowlist_remove_aria({ host: entry })}
                  onClick={() => setEntries(entries.filter((e) => e !== entry))}
                  className="inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            {entries.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">
                {m.admin_plugins_allowlist_empty()}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEntry();
                }
              }}
              placeholder={m.admin_plugins_allowlist_placeholder()}
              className="h-8 max-w-xs font-mono text-xs"
            />
            <Button type="button" size="sm" variant="outline" onClick={addEntry}>
              <PlusIcon /> {m.admin_plugins_allowlist_add()}
            </Button>
          </div>
          {draftError ? <p className="text-xs text-destructive">{draftError}</p> : null}
          {intersectionEmpty ? (
            <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              {m.admin_plugins_allowlist_warning()}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={update.isPending}>
          {update.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {m.admin_plugins_allowlist_save()}
        </Button>
      </div>
    </section>
  );
}

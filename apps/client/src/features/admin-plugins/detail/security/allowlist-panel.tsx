import { useEffect, useState } from "react";
import { LoaderCircleIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { PLUGIN_ADMIN_ALLOWLIST_MAX } from "@ent-mcp/shared/plugins";

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

  useEffect(() => {
    setMode(stored === null ? "inherit" : "restrict");
    setEntries(stored ?? []);
  }, [stored]);

  const addEntry = () => {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) return;
    if (!HOST_PATTERN.test(normalized)) {
      setDraftError('Must be "*", a hostname, or "*.domain"');
      return;
    }
    if (entries.includes(normalized)) {
      setDraftError("Already in list");
      return;
    }
    if (entries.length >= PLUGIN_ADMIN_ALLOWLIST_MAX) {
      setDraftError(`At most ${PLUGIN_ADMIN_ALLOWLIST_MAX} entries`);
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
        !entries.some((a) => manifestHosts.some((m) => patternsOverlap(a, m)))));

  const save = () => {
    update.mutate(mode === "inherit" ? null : entries);
  };

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="text-sm font-medium">Network destinations</h3>
        <p className="text-xs text-muted-foreground">
          Limit which hosts {plugin.manifest.name} can reach. Narrows the plugin's declared hosts;
          user-supplied server URLs (x-allowed-host) are unaffected.
        </p>
      </header>

      {manifestHosts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
            Declared by manifest
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
          <span>Inherit manifest (default)</span>
        </Label>
        <Label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
          <RadioGroupItem value="restrict" className="mt-0.5" />
          <span>Restrict to specific hosts</span>
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
                  aria-label={`Remove ${entry}`}
                  onClick={() => setEntries(entries.filter((e) => e !== entry))}
                  className="inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            {entries.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">
                No hosts — every outbound request will be blocked.
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
              placeholder="api.example.com or *.example.com"
              className="h-8 max-w-xs font-mono text-xs"
            />
            <Button type="button" size="sm" variant="outline" onClick={addEntry}>
              <PlusIcon /> Add
            </Button>
          </div>
          {draftError ? <p className="text-xs text-destructive">{draftError}</p> : null}
          {intersectionEmpty ? (
            <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              Plugin will make no network calls with this configuration. User-supplied server URLs
              (x-allowed-host) are unaffected.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={update.isPending}>
          {update.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          Save allowlist
        </Button>
      </div>
    </section>
  );
}

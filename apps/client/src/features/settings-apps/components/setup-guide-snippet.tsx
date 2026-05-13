import { CheckIcon, CopyIcon } from "lucide-react";

import { useCopyFeedback } from "@/shared/hooks/use-copy-feedback";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

export function SetupGuideSnippet({ sectionId, content }: { sectionId: string; content: string }) {
  const { copied, copy } = useCopyFeedback();

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground">JSON</span>
        <button
          type="button"
          onClick={() => void copy(content)}
          aria-label={m.settings_apps_setup_guide_copy_snippet()}
          data-testid={`setup-guide-copy-${sectionId}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            copied
              ? "bg-success/15 text-success"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          {copied
            ? m.settings_apps_setup_guide_copied()
            : m.settings_apps_setup_guide_copy_snippet()}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground">
        <code>{content}</code>
      </pre>
    </div>
  );
}

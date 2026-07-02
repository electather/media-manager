import { useId } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { m } from "@/paraglide/messages";

import { SetupGuideSnippet } from "./setup-guide-snippet";

interface SetupGuideModalProps {
  endpoint: string;
  open: boolean;
  onClose: () => void;
}

interface GuideSection {
  id: "claude-desktop" | "cursor" | "generic";
  title: () => string;
  steps: () => string;
  /** Snippet emitted before the endpoint URL is interpolated. `null` for plain-URL clients. */
  snippet: ((endpoint: string) => string) | null;
}

const SECTIONS: ReadonlyArray<GuideSection> = [
  {
    id: "claude-desktop",
    title: () => m.settings_apps_setup_guide_claude_desktop_title(),
    steps: () => m.settings_apps_setup_guide_claude_desktop_steps(),
    snippet: (endpoint) => JSON.stringify({ mcpServers: { nama: { url: endpoint } } }, null, 2),
  },
  {
    id: "cursor",
    title: () => m.settings_apps_setup_guide_cursor_title(),
    steps: () => m.settings_apps_setup_guide_cursor_steps(),
    snippet: (endpoint) => JSON.stringify({ mcpServers: { nama: { url: endpoint } } }, null, 2),
  },
  {
    id: "generic",
    title: () => m.settings_apps_setup_guide_generic_title(),
    steps: () => m.settings_apps_setup_guide_generic_steps(),
    snippet: null,
  },
];

export function SetupGuideModal({ endpoint, open, onClose }: SetupGuideModalProps) {
  const isMobile = useIsMobile();
  const titleId = useId();

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="down">
        <DrawerContent aria-labelledby={titleId} className="max-h-[90dvh] gap-0 bg-card p-0">
          <DrawerHeader className="border-b border-border px-5 pt-6 pb-4 text-start">
            <DrawerTitle id={titleId} className="text-base">
              {m.settings_apps_setup_guide_title()}
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              {m.settings_apps_setup_guide_description()}
            </DrawerDescription>
          </DrawerHeader>
          <SetupGuideBody endpoint={endpoint} onClose={onClose} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-[min(40rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle id={titleId}>{m.settings_apps_setup_guide_title()}</DialogTitle>
          <DialogDescription>{m.settings_apps_setup_guide_description()}</DialogDescription>
        </DialogHeader>
        <SetupGuideBody endpoint={endpoint} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function SetupGuideBody({ endpoint, onClose }: { endpoint: string; onClose: () => void }) {
  return (
    <>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5 sm:px-6">
        {SECTIONS.map((section) => (
          <SetupGuideSection key={section.id} section={section} endpoint={endpoint} />
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3 sm:px-6">
        <Button variant="outline" size="sm" onClick={onClose}>
          {m.settings_apps_setup_guide_close()}
        </Button>
      </div>
    </>
  );
}

function SetupGuideSection({ section, endpoint }: { section: GuideSection; endpoint: string }) {
  return (
    <section className="rounded-lg border border-border bg-muted/40 p-4">
      <h4 className="text-sm font-semibold text-foreground">{section.title()}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{section.steps()}</p>
      {section.snippet ? (
        <SetupGuideSnippet sectionId={section.id} content={section.snippet(endpoint)} />
      ) : null}
    </section>
  );
}

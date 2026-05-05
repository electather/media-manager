import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";
import { Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function CommandMenuTrigger() {
  const open = () => window.dispatchEvent(new CustomEvent("nama:open-command"));

  return (
    <Button
      type="button"
      onClick={open}
      variant="outline"
      size="sm"
      aria-label="Open command menu"
      className={cn("cursor-pointer gap-2")}
    >
      <Search />
      <Kbd className="border border-border">
        <span className="ms-px">/</span>
      </Kbd>
    </Button>
  );
}

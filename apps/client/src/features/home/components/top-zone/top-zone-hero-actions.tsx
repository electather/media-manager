import { Info, Play, X } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

type Props = {
  hasProgress: boolean;
  onMoreInfo: () => void;
  onDismiss?: () => void;
};

export function TopZoneHeroActions({ hasProgress, onMoreInfo, onDismiss }: Props) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button size="default" className="gap-2">
        <Play aria-hidden="true" className="size-4 fill-current" />
        {hasProgress ? m.home_hero_resume() : m.home_hero_play()}
      </Button>
      <Button size="default" variant="secondary" className="gap-2" onClick={onMoreInfo}>
        <Info aria-hidden="true" className="size-4" />
        {m.home_hero_more_info()}
      </Button>
      {onDismiss ? (
        <Button
          size="default"
          variant="ghost"
          className="gap-2 text-muted-foreground"
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="size-4" />
          {m.home_hero_dismiss()}
        </Button>
      ) : null}
    </div>
  );
}

import { Info, Play, X } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

type Props = {
  hasProgress: boolean;
  /**
   * Play handler. v1 has no `playback@v1.getResumeUrl` capability, so the
   * orchestrator always emits `resumeUrl: null` and the parent wires this
   * to a nav-to-detail action — the user lands on the detail page where
   * the request flow can take over.
   */
  onPlay: () => void;
  onMoreInfo: () => void;
  onDismiss?: () => void;
};

export function TopZoneHeroActions({ hasProgress, onPlay, onMoreInfo, onDismiss }: Props) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button size="default" className="gap-2" onClick={onPlay}>
        <Play aria-hidden="true" />
        {hasProgress ? m.home_hero_resume() : m.home_hero_play()}
      </Button>
      <Button size="default" variant="secondary" className="gap-2" onClick={onMoreInfo}>
        <Info aria-hidden="true" />
        {m.home_hero_more_info()}
      </Button>
      {onDismiss ? (
        <Button size="default" variant="outline" className="gap-2" onClick={onDismiss}>
          <X aria-hidden="true" />
          {m.home_hero_dismiss()}
        </Button>
      ) : null}
    </div>
  );
}

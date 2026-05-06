import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

export function DetailNotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-medium">{m.media_detail_not_found_title()}</p>
      <Button render={<Link to="/" />} variant="outline" className="gap-2">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {m.media_detail_back_to_home()}
      </Button>
    </div>
  );
}

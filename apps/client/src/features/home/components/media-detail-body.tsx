import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";

import { parseCompactId } from "../lib/parse-id";

interface MediaDetailBodyProps {
  id: string;
  inModal: boolean;
}

export function MediaDetailBody({ id, inModal }: MediaDetailBodyProps) {
  const navigate = useNavigate();
  const parsed = parseCompactId(id);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {inModal ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeftIcon /> Back
        </Button>
      )}
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {parsed ? `${parsed.mediaType === "movie" ? "Movie" : "TV"} · ${parsed.tmdbId}` : id}
        </h1>
        <p className="text-sm text-muted-foreground">
          Detail view scaffold. Body content lands in a follow-up spec.
        </p>
      </header>
    </div>
  );
}

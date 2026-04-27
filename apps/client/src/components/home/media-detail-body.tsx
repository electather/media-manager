import { useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MediaDetailBodyProps {
  id: string;
  inModal: boolean;
}

// The detail view's data model and full layout live in a later spec —
// this body is the minimum that lets the modal/route pair render today.
export function MediaDetailBody({ id, inModal }: MediaDetailBodyProps) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      {!inModal ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const len = router.history.length;
            if (len > 1) router.history.go(-1);
            else void router.navigate({ to: "/" });
          }}
          className="self-start"
        >
          <ArrowLeftIcon className="size-4" />
          Back
        </Button>
      ) : null}
      <h1 className="text-xl font-semibold tracking-tight">Media {id}</h1>
      <p className="text-sm text-muted-foreground">
        Detail view content lives in a follow-up spec. This is the placeholder body that renders in
        both the layout-level peek modal and the standalone <code>/media/$id</code> route.
      </p>
    </div>
  );
}

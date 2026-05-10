import { Link } from "@tanstack/react-router";
import { HomeIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import {
  ErrorPage,
  ErrorPageActions,
  ErrorPageDescription,
  ErrorPageFrame,
  ErrorPageHeadline,
} from "@/shared/components/error-page";
import { Button } from "@/shared/ui/button";

export function NotFound() {
  return (
    <ErrorPage tone="info">
      <ErrorPageFrame>
        <ErrorPageHeadline code="404" eyebrow={m.errors_not_found_eyebrow()}>
          {m.errors_not_found_headline()}
        </ErrorPageHeadline>
        <ErrorPageDescription>{m.errors_not_found_body()}</ErrorPageDescription>
        <ErrorPageActions>
          <Button render={<Link to="/" />}>
            <HomeIcon aria-hidden="true" />
            {m.errors_action_back_home()}
          </Button>
        </ErrorPageActions>
      </ErrorPageFrame>
    </ErrorPage>
  );
}

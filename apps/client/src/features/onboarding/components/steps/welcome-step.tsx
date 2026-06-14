import { SparklesIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

/** Static, informational welcome step. Always complete; takes no input. */
export function WelcomeStep() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {m.onboarding_welcome_heading()}
        </h2>
        <p className="text-sm text-muted-foreground">{m.onboarding_welcome_intro()}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
            {m.onboarding_welcome_mcp_heading()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{m.onboarding_welcome_mcp_body()}</p>
        </CardContent>
      </Card>
    </div>
  );
}

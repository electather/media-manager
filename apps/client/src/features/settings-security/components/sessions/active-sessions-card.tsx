import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";

import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { useRevokeOtherSessions, useRevokeSession } from "../../hooks/use-sessions";
import type { DisplaySession } from "../../lib/types";
import { SessionListRow } from "./session-row";
import { RevokeAllSessionsDialog, RevokeSessionDialog } from "./revoke-dialogs";

export function ActiveSessionsCard({ sessions }: { sessions: ReadonlyArray<DisplaySession> }) {
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [revokeOneTarget, setRevokeOneTarget] = useState<DisplaySession | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  const others = sessions.filter((s) => !s.current).length;

  const doRevokeOne = () => {
    if (!revokeOneTarget) return;
    revokeOne.mutate(revokeOneTarget.token, {
      onSuccess: () => toast.success(m.settings_security_toast_session_revoked()),
      onError: (err) => toast.error(err.message),
    });
    setRevokeOneTarget(null);
  };

  const doRevokeAll = () => {
    revokeOthers.mutate(undefined, {
      onSuccess: () =>
        toast.success(m.settings_security_toast_signed_out_others({ count: others })),
      onError: (err) => toast.error(err.message),
    });
    setRevokeAll(false);
  };

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_security_sessions_title()}
        description={m.settings_security_sessions_description()}
        action={
          others > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setRevokeAll(true)}>
              {m.settings_security_sessions_signout_others()}
            </Button>
          ) : null
        }
      />
      {sessions.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {m.settings_security_sessions_empty()}
        </p>
      ) : (
        <ul role="list" className="flex flex-col">
          {sessions.map((s, i) => (
            <SessionListRow
              key={s.id}
              session={s}
              isFirst={i === 0}
              onRevoke={() => setRevokeOneTarget(s)}
            />
          ))}
        </ul>
      )}
      <RevokeSessionDialog
        session={revokeOneTarget}
        onClose={() => setRevokeOneTarget(null)}
        onConfirm={doRevokeOne}
      />
      <RevokeAllSessionsDialog
        open={revokeAll}
        count={others}
        onClose={() => setRevokeAll(false)}
        onConfirm={doRevokeAll}
      />
    </SettingsCard>
  );
}

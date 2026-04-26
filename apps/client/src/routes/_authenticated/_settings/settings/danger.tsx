import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { triggerAnchorDownload } from "@/lib/anchor-download";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/_settings/settings/danger")({
  component: DangerZoneSection,
});

function DangerZoneSection() {
  const session = authClient.useSession();
  const userEmail = session.data?.user?.email ?? "";

  return (
    <div className="flex flex-col gap-6">
      <Header />
      <ExportCard />
      <DeleteCard currentEmail={userEmail} />
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="text-base font-medium">Danger zone</h2>
      <p className="mt-1 text-sm text-muted-foreground">Irreversible actions. Proceed with care.</p>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function ExportCard() {
  const [exporting, setExporting] = useState(false);

  const startExport = () => {
    setExporting(true);
    triggerAnchorDownload("/api/me/export");
    // Anchor-navigation errors don't bubble to window.onerror, so the
    // best we can do is leave the spinner up briefly and let the browser
    // surface a download-failed UI if the request 5xx's.
    window.setTimeout(() => setExporting(false), 1500);
  };

  return (
    <div className="flex max-w-lg items-center justify-between gap-4 rounded-xl border border-border px-5 py-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Export my data</p>
        <p className="text-xs text-muted-foreground">
          Download a ZIP of your account data — identity, taste profile, feedback history, and
          connection metadata (no credentials or access tokens).
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={exporting}
        onClick={startExport}
        data-testid="export-data"
      >
        {exporting ? <LoaderCircleIcon className="animate-spin" /> : null}
        Export my data
      </Button>
    </div>
  );
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function DeleteCard({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex max-w-lg items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-xs text-muted-foreground">
            Permanently delete your account and all associated data — connections, taste profile,
            feedback history, and preferences. This cannot be undone.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="open-delete">
          Delete account
        </Button>
      </div>

      {open ? (
        <DeleteAccountDialog currentEmail={currentEmail} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function DeleteAccountDialog({
  currentEmail,
  onClose,
}: {
  currentEmail: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const ready =
    confirmEmail.trim().toLowerCase() === currentEmail.toLowerCase() && password.length > 0;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.me.delete.$post({
        json: { confirmEmail: confirmEmail.trim(), currentPassword: password },
      });
      if (!res.ok) {
        throw Object.assign(new Error("delete failed"), { status: res.status });
      }
    },
    onSuccess: async () => {
      toast.success("Your account has been deleted.");
      try {
        await authClient.signOut();
      } catch {
        // Server already invalidated the session; ignore.
      }
      void navigate({ to: "/auth/login", replace: true });
    },
    onError: (err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 401) {
        setPasswordError("That password is incorrect.");
        return;
      }
      toast.error("Could not delete account.");
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !deleteMutation.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!deleteMutation.isPending}>
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This will permanently delete your account and all data. Type your email address{" "}
            <strong className="text-foreground">{currentEmail}</strong> to confirm, and enter your
            password.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldTitle>Email</FieldTitle>
            <Input
              placeholder={currentEmail}
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              data-testid="delete-email"
            />
          </Field>
          <Field data-invalid={passwordError ? true : undefined}>
            <FieldTitle>Password</FieldTitle>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              aria-invalid={passwordError ? true : undefined}
              data-testid="delete-password"
            />
            {passwordError ? <FieldError>{passwordError}</FieldError> : null}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={!ready || deleteMutation.isPending}
            data-testid="confirm-delete"
          >
            {deleteMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Delete my account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  name: "Alex Morgan",
  email: "alex@example.com",
  color: "#8B5CF6",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings/danger")({
  component: DangerZoneSection,
});

function DangerZoneSection() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const email = MOCK_USER.email;

  const handleClose = () => {
    setDeleteOpen(false);
    setDeleteConfirm("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-medium">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Irreversible actions. Proceed with care.
        </p>
      </div>

      <div className="flex max-w-lg items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-xs text-muted-foreground">
            Permanently delete your account and all associated data — connections, taste profile,
            feedback history, and preferences. This cannot be undone.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This will permanently delete your account and all data. Type your email address{" "}
              <strong className="text-foreground">{email}</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Your email address"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteConfirm !== email} onClick={handleClose}>
              Delete my account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

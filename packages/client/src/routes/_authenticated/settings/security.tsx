import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Field, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings/security")({
  component: SecuritySection,
});

function SecuritySection() {
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-medium">Security</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your password and active sessions.
        </p>
      </div>

      <div className="flex max-w-sm flex-col gap-4">
        <Field>
          <FieldTitle>Password</FieldTitle>
          {!pwOpen ? (
            <div>
              <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
                Change password
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <Field>
                <FieldTitle>Current password</FieldTitle>
                <Input type="password" defaultValue="••••••••••" />
              </Field>
              <Field>
                <FieldTitle>New password</FieldTitle>
                <Input type="password" placeholder="At least 12 characters" />
              </Field>
              <Field>
                <FieldTitle>Confirm new password</FieldTitle>
                <Input type="password" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPwOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => setPwOpen(false)}>
                  Save password
                </Button>
              </div>
            </div>
          )}
        </Field>
      </div>
    </div>
  );
}

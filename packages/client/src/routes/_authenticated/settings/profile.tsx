import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  name: "Alex Morgan",
  email: "alex@example.com",
  color: "#8B5CF6",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfileSection,
});

function ProfileSection() {
  const [name, setName] = useState(MOCK_USER.name);
  const [email, setEmail] = useState(MOCK_USER.email);
  const [saved, setSaved] = useState(false);

  const dirty = name !== MOCK_USER.name || email !== MOCK_USER.email;

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-medium">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your personal information. Initials are generated from your name and shown in other users'
          views where relevant.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <UserAvatar name={name} email={email} size="lg" />
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">Avatar generated from your name.</p>
        </div>
      </div>

      <div className="flex max-w-sm flex-col gap-4">
        <Field>
          <FieldTitle>Name</FieldTitle>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field>
          <FieldTitle>Email</FieldTitle>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <FieldDescription>Changing your email will require verification.</FieldDescription>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!dirty} onClick={handleSave}>
          Save changes
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckIcon className="size-3" /> Saved
          </span>
        )}
        {!dirty && !saved && <span className="text-xs text-muted-foreground">No changes</span>}
      </div>
    </div>
  );
}

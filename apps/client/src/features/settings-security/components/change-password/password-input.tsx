import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Input } from "@/shared/ui/input";
import { m } from "@/paraglide/messages";

interface PasswordInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
  ariaInvalid?: boolean;
  "data-testid"?: string;
}

// CRAP is inflated by show/hide toggle JSX, not branching logic.
// fallow-ignore-next-line complexity
export function PasswordInput(props: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  const { value, onChange, ...rest } = props;
  return (
    <div className="relative">
      <Input
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={rest.ariaInvalid ? true : undefined}
        autoComplete={rest.autoComplete}
        placeholder={rest.placeholder}
        data-testid={rest["data-testid"]}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={
          shown ? m.settings_security_password_hide() : m.settings_security_password_show()
        }
        className="absolute inset-y-0 right-1 flex w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

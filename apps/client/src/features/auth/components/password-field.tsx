import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";

interface PasswordFieldProps {
  id: string;
  value: string;
  disabled?: boolean;
  autoComplete?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Render the show/hide reveal toggle. Default `true`. */
  toggle?: boolean;
}

// fallow-ignore-next-line complexity
export function PasswordField({
  id,
  value,
  disabled,
  autoComplete,
  placeholder = "••••••••",
  onChange,
  onBlur,
  toggle = true,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        disabled={disabled}
        className={toggle ? "pr-10" : undefined}
      />
      {toggle ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={-1}
          aria-label={visible ? m.auth_hide_password_aria() : m.auth_show_password_aria()}
          aria-pressed={visible}
          className="absolute inset-y-0 inset-e-0 h-full px-3 text-muted-foreground hover:text-foreground"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          <span className="sr-only">
            {visible ? m.auth_hide_password() : m.auth_show_password()}
          </span>
        </Button>
      ) : null}
    </div>
  );
}

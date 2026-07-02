import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

/** Heuristic 0–4 password strength score driving the meter and label. */
function passwordScore(pw: string): number {
  if (!pw) return 0;
  const checks = [
    pw.length >= 8,
    pw.length >= 12,
    /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    /\d/.test(pw),
    /[^A-Za-z0-9]/.test(pw),
  ];
  const passed = checks.filter(Boolean).length;
  return Math.min(4, passed);
}

export function PasswordMeter({ value }: { value: string }) {
  const score = passwordScore(value);
  const labels = [
    m.settings_security_password_strength_too_short(),
    m.settings_security_password_strength_weak(),
    m.settings_security_password_strength_fair(),
    m.settings_security_password_strength_good(),
    m.settings_security_password_strength_strong(),
  ];
  const tones = ["bg-muted", "bg-destructive", "bg-amber-400", "bg-success", "bg-success"];
  return (
    <div className="mt-2 flex items-center gap-2.5">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < score ? tones[score] : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className="min-w-16 text-end text-xs tabular-nums text-muted-foreground">
        {value ? labels[score] : ""}
      </span>
    </div>
  );
}

import type { ReactNode } from "react";

export function DetailSection({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle?: string;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3
          className={`text-sm font-semibold tracking-tight ${
            tone === "danger" ? "text-destructive" : "text-foreground"
          }`}
        >
          {title}
        </h3>
        {subtitle ? <p className="max-w-prose text-xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

import type { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  children: ReactNode;
};

export function DetailSection({ id, title, children }: Props) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="mb-4 font-heading text-lg font-semibold tracking-[-0.005em] text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

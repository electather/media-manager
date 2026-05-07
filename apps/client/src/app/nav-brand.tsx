import { Link } from "@tanstack/react-router";
import { Logo } from "@/shared/components/logo";

export function NavBrand({ scrolled }: { scrolled: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span
        data-scrolled={scrolled}
        className="inline-flex origin-left text-primary transition-transform duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] data-[scrolled=true]:scale-[0.90]"
      >
        <Logo className="size-10 opacity-85" />
      </span>
    </Link>
  );
}

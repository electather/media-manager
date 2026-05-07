import type { SVGProps } from "react";
import { cn } from "../lib/utils";

export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      fill="currentColor"
      className={cn("text-foreground", className)}
      {...props}
    >
      <path
        id="p"
        d="M756,553.2C735,548.4 714.3,543.9 693.8,539 669.9,533.4 652.1,520.1 643.1,496.7 627.4,455.9 658,410 702.1,409 720,408.6 738,410.5 755.9,411.4 769.7,412.1 783.5,413.1 797.3,413.7 816.9,414.5 834.9,419.7 849.4,433.3 871.8,454.2 880,480.1 871.4,509.5 863,538.4 842.9,555.8 812.9,560.9 804.9,562.2 796.7,561.9 788.6,560.2 777.8,557.9 767.1,555.6 756,553.2Z"
      />
      <use href="#p" transform="rotate(45 512 512)" />
      <use href="#p" transform="rotate(90 512 512)" />
      <use href="#p" transform="rotate(135 512 512)" />
      <use href="#p" transform="rotate(180 512 512)" />
      <use href="#p" transform="rotate(225 512 512)" />
      <use href="#p" transform="rotate(270 512 512)" />
      <use href="#p" transform="rotate(315 512 512)" className="fill-primary" />
    </svg>
  );
}

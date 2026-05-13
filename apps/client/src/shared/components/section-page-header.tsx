import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import { sectionTransitionClickHandler } from "@/shared/lib/view-transition";

interface SectionPageHeaderProps {
  title: string;
  description?: string;
  status?: ReactNode;
  /** Where the mobile back link points (the section index, e.g. /settings or /admin). */
  backTo: string;
  /** Visible label for the back link. */
  backLabel: string;
}

/**
 * Standard section sub-page header. Keeps title, description, and the mobile
 * breadcrumb consistent across all settings and admin sub-pages.
 */
export function SectionPageHeader({
  title,
  description,
  status,
  backTo,
  backLabel,
}: SectionPageHeaderProps) {
  const navigate = useNavigate();
  const onBackClick = sectionTransitionClickHandler("nav-back", () => navigate({ to: backTo }));
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-6">
      <Breadcrumb className="md:hidden">
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem onClickCapture={onBackClick}>
            <BreadcrumbLink render={<Link to={backTo} />}>{backLabel}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {status}
      </div>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}

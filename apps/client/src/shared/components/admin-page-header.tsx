import type { ReactNode } from "react";

import { m } from "@/paraglide/messages";
import { SectionPageHeader } from "@/shared/components/section-page-header";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  status?: ReactNode;
}

/**
 * Admin sub-page header — thin wrapper around `SectionPageHeader` with the
 * back link pointing to the admin index.
 */
export function AdminPageHeader({ title, description, status }: AdminPageHeaderProps) {
  return (
    <SectionPageHeader
      title={title}
      description={description}
      status={status}
      backTo="/admin"
      backLabel={m.admin_back_to_admin()}
    />
  );
}

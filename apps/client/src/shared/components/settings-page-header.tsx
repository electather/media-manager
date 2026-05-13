import type { ReactNode } from "react";

import { m } from "@/paraglide/messages";
import { SectionPageHeader } from "@/shared/components/section-page-header";

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  status?: ReactNode;
}

/**
 * Settings sub-page header — thin wrapper around `SectionPageHeader` with the
 * back link pointing to the settings index.
 */
export function SettingsPageHeader({ title, description, status }: SettingsPageHeaderProps) {
  return (
    <SectionPageHeader
      title={title}
      description={description}
      status={status}
      backTo="/settings"
      backLabel={m.settings_back_to_settings()}
    />
  );
}

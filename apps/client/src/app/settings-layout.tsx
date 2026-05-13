import {
  AlertTriangleIcon,
  BellIcon,
  CogIcon,
  LayersIcon,
  PlugIcon,
  ShieldIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import {
  SettingsDirtyProvider,
  useSettingsDirtyState,
} from "@/features/settings/components/dirty-bar-context";
import {
  SectionIndex,
  SectionLabel,
  SectionLayout,
  type SectionNavGroup,
} from "@/app/section-shell";

const SETTINGS_GROUPS: ReadonlyArray<SectionNavGroup> = [
  {
    id: "account",
    heading: () => m.settings_group_account(),
    items: [
      {
        to: "/settings/profile",
        label: () => m.settings_nav_profile(),
        intro: () => m.settings_nav_profile_intro(),
        icon: CogIcon,
      },
      {
        to: "/settings/security",
        label: () => m.settings_nav_security(),
        intro: () => m.settings_nav_security_intro(),
        icon: ShieldIcon,
      },
    ],
  },
  {
    id: "integrations",
    heading: () => m.settings_group_integrations(),
    items: [
      {
        to: "/settings/connections",
        label: () => m.settings_nav_connections(),
        intro: () => m.settings_nav_connections_intro(),
        icon: PlugIcon,
      },
      {
        to: "/settings/apps",
        label: () => m.settings_nav_apps(),
        intro: () => m.settings_nav_apps_intro(),
        icon: LayersIcon,
      },
    ],
  },
  {
    id: "preferences",
    heading: () => m.settings_group_preferences(),
    items: [
      {
        to: "/settings/notifications",
        label: () => m.settings_nav_notifications(),
        intro: () => m.settings_nav_notifications_intro(),
        icon: BellIcon,
      },
    ],
  },
  {
    id: "danger",
    heading: () => m.settings_group_danger(),
    items: [
      {
        to: "/settings/danger",
        label: () => m.settings_nav_danger(),
        intro: () => m.settings_nav_danger_intro(),
        icon: AlertTriangleIcon,
        destructive: true,
      },
    ],
  },
];

export function SettingsLayout() {
  return (
    <SettingsDirtyProvider>
      <SectionLayout
        title={m.settings_title()}
        groups={SETTINGS_GROUPS}
        overlay={<SettingsDirtyBar />}
      />
    </SettingsDirtyProvider>
  );
}

// ─── Dirty / sticky save bar ────────────────────────────────────────────────

function SettingsDirtyBar() {
  const { active } = useSettingsDirtyState();
  return (
    <div
      role="region"
      aria-label={m.settings_dirty_label()}
      data-open={active ? "true" : "false"}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 transition-all duration-300 ease-out",
        active ? "translate-y-0 opacity-100" : "translate-y-32 opacity-0",
      )}
    >
      {active ? (
        <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border border-border bg-card/95 py-2 pl-4 pr-2 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_4px] shadow-primary/20"
          />
          <div className="flex-1 truncate text-sm text-muted-foreground">{active.label}</div>
          <Button variant="ghost" size="sm" onClick={() => active.onDiscard?.()}>
            {m.settings_dirty_discard()}
          </Button>
          <Button size="sm" onClick={() => active.onSave?.()}>
            {m.settings_dirty_save()}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SettingsSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <SectionLabel className={className}>{children}</SectionLabel>;
}

// ─── Mobile drill-down list (used by /settings index on small screens) ──────

export function SettingsIndex() {
  return (
    <SectionIndex
      title={m.settings_title()}
      subtitle={m.settings_subtitle()}
      groups={SETTINGS_GROUPS}
      desktopRedirectTo="/settings/profile"
    />
  );
}

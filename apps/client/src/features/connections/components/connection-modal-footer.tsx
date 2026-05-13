import type { ReactNode } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import type { AuthKind, DeviceState, Stage, TestState } from "../lib/types";

interface Props {
  authKind: AuthKind;
  isEdit: boolean;
  stage: Stage;
  hasUserConfigFields: boolean;
  test: TestState;
  saving: boolean;
  device: DeviceState;
  onCancel: () => void;
  onDone: () => void;
  onTest: () => void;
  onSaveForm: () => void;
  onSaveOauthEdit: () => void;
  onStartDevice: () => void;
  onStartRedirect: () => void;
}

// Layout: column on mobile (Save closest to thumb), row on desktop with the
// primary action rightmost and any secondary "Test connection" pinned left.
const ROW_CLASS =
  "flex shrink-0 flex-col gap-2 border-t border-border bg-muted/30 px-6 py-3 sm:flex-row sm:items-center sm:justify-end";
const MOBILE_FULL = "w-full sm:w-auto";

function FooterShell({ children }: { children: ReactNode }) {
  return <div className={ROW_CLASS}>{children}</div>;
}

// fallow-ignore-next-line complexity
export function ConnectionModalFooter(props: Props) {
  const {
    authKind,
    isEdit,
    stage,
    test,
    saving,
    device,
    onCancel,
    onDone,
    onTest,
    onSaveForm,
    onSaveOauthEdit,
    onStartDevice,
    onStartRedirect,
    hasUserConfigFields,
  } = props;

  if (stage === "done") {
    return (
      <FooterShell>
        <Button onClick={onDone} className={MOBILE_FULL}>
          {m.settings_connections_modal_action_done()}
        </Button>
      </FooterShell>
    );
  }

  if (authKind === "form") {
    return (
      <FooterShell>
        <div className="flex flex-col gap-1 sm:mr-auto sm:flex-row sm:items-center sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={test.kind === "testing" || saving}
            className={MOBILE_FULL}
          >
            {test.kind === "testing" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : test.kind === "ok" ? (
              <CheckIcon />
            ) : null}
            {m.settings_connections_modal_action_test({ state: test.kind })}
          </Button>
          {test.kind === "ok" ? (
            <span className="text-center text-xs text-success sm:text-left">
              {m.settings_connections_modal_test_verified()}
            </span>
          ) : null}
        </div>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={saving}
          className={cn(MOBILE_FULL, "sm:order-1")}
        >
          {m.settings_connections_modal_action_cancel()}
        </Button>
        <Button onClick={onSaveForm} disabled={saving} className={cn(MOBILE_FULL, "sm:order-2")}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          {isEdit
            ? m.settings_connections_modal_action_save_changes()
            : m.settings_connections_modal_action_save_connection()}
        </Button>
      </FooterShell>
    );
  }

  if (authKind === "oauth_device") {
    if (isEdit) {
      return (
        <CancelPrimaryFooter
          primaryLabel={m.settings_connections_modal_action_save_changes()}
          primaryDisabled={saving}
          primaryLoading={saving}
          onCancel={onCancel}
          onPrimary={onSaveOauthEdit}
        />
      );
    }
    if (device.kind === "waiting") {
      return (
        <FooterShell>
          <Button variant="outline" onClick={onCancel} className={MOBILE_FULL}>
            {m.settings_connections_modal_action_cancel()}
          </Button>
        </FooterShell>
      );
    }
    const startDisabled = device.kind === "starting";
    return (
      <CancelPrimaryFooter
        primaryLabel={m.settings_connections_modal_action_connect()}
        primaryDisabled={startDisabled}
        primaryLoading={startDisabled}
        onCancel={onCancel}
        onPrimary={onStartDevice}
      />
    );
  }

  if (authKind === "oauth_redirect") {
    if (isEdit) {
      return (
        <CancelPrimaryFooter
          primaryLabel={m.settings_connections_modal_action_save_changes()}
          primaryDisabled={saving}
          primaryLoading={false}
          onCancel={onCancel}
          onPrimary={onSaveOauthEdit}
        />
      );
    }
    return (
      <CancelPrimaryFooter
        primaryLabel={m.settings_connections_modal_action_connect()}
        primaryDisabled={saving}
        primaryLoading={saving}
        onCancel={onCancel}
        onPrimary={onStartRedirect}
      />
    );
  }

  if (authKind === "none") {
    const primaryLabel = !hasUserConfigFields
      ? m.settings_connections_modal_action_connect()
      : isEdit
        ? m.settings_connections_modal_action_save_changes()
        : m.settings_connections_modal_action_save_connection();
    return (
      <CancelPrimaryFooter
        primaryLabel={primaryLabel}
        primaryDisabled={saving}
        primaryLoading={saving}
        onCancel={onCancel}
        onPrimary={onSaveForm}
      />
    );
  }

  return null;
}

function CancelPrimaryFooter({
  primaryLabel,
  primaryDisabled,
  primaryLoading,
  onCancel,
  onPrimary,
}: {
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryLoading: boolean;
  onCancel: () => void;
  onPrimary: () => void;
}) {
  return (
    <FooterShell>
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={primaryDisabled}
        className={cn(MOBILE_FULL, "sm:order-1")}
      >
        {m.settings_connections_modal_action_cancel()}
      </Button>
      <Button
        onClick={onPrimary}
        disabled={primaryDisabled}
        className={cn(MOBILE_FULL, "sm:order-2")}
      >
        {primaryLoading ? <LoaderCircleIcon className="animate-spin" /> : null}
        {primaryLabel}
      </Button>
    </FooterShell>
  );
}

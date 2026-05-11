import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import type { JSONSchema } from "@ent-mcp/shared";
import { SchemaForm } from "@/shared/components/schema-form";

import type { AuthKind, DeviceState, PluginSummary } from "../lib/types";
import { DeviceCodePanel } from "./device-code-panel";
import { OauthEditNotice, OauthIntro } from "./oauth-intro";

interface Props {
  authKind: AuthKind;
  isEdit: boolean;
  hasUserConfigFields: boolean;
  userConfigSchema: JSONSchema | null;
  values: Record<string, unknown>;
  setValues: (next: Record<string, unknown>) => void;
  serverErrors: Record<string, string>;
  submitAttempted: boolean;
  plugin: PluginSummary;
  device: DeviceState;
  now: number;
  onRetryDevice: () => void;
}

// fallow-ignore-next-line complexity
export function ConnectionModalBody({
  authKind,
  isEdit,
  hasUserConfigFields,
  userConfigSchema,
  values,
  setValues,
  serverErrors,
  submitAttempted,
  plugin,
  device,
  now,
  onRetryDevice,
}: Props) {
  if (authKind === "form") {
    if (!userConfigSchema) {
      return (
        <p className="text-sm text-muted-foreground">
          {m.settings_connections_modal_no_user_config()}
        </p>
      );
    }
    return (
      <SchemaForm
        schema={userConfigSchema}
        value={values}
        onChange={setValues}
        serverErrors={serverErrors}
        mode={isEdit ? "edit" : "create"}
        submitAttempted={submitAttempted}
      />
    );
  }

  if (authKind === "oauth_device") {
    if (isEdit) return <OauthEditNotice plugin={plugin} />;
    if (device.kind === "waiting") return <DeviceCodePanel device={device} now={now} />;
    if (device.kind === "err") {
      return (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-5 text-sm text-destructive">
          <span>{device.message}</span>
          <div>
            <Button variant="outline" size="sm" onClick={onRetryDevice}>
              {m.settings_connections_modal_device_try_again()}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <OauthIntro
        plugin={plugin}
        body={m.settings_connections_modal_oauth_device_body({ name: plugin.name })}
      />
    );
  }

  if (authKind === "oauth_redirect") {
    if (isEdit) return <OauthEditNotice plugin={plugin} />;
    return (
      <OauthIntro
        plugin={plugin}
        body={m.settings_connections_modal_oauth_redirect_body({ name: plugin.name })}
      />
    );
  }

  if (authKind === "none") {
    if (hasUserConfigFields && userConfigSchema) {
      return (
        <SchemaForm
          schema={userConfigSchema}
          value={values}
          onChange={setValues}
          serverErrors={serverErrors}
          mode={isEdit ? "edit" : "create"}
          submitAttempted={submitAttempted}
        />
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        {m.settings_connections_modal_no_config_required()}
      </p>
    );
  }

  return null;
}

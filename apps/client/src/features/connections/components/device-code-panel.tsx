import { ClockIcon, ExternalLinkIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { CopyButton } from "@/shared/components/copy-button";

import { isSafeAuthUrl } from "../lib/url";
import type { DeviceState } from "../lib/types";

interface Props {
  device: Extract<DeviceState, { kind: "waiting" }>;
  now: number;
}

export function DeviceCodePanel({ device, now }: Props) {
  const remaining = Math.max(0, Math.floor((device.expiresAt - now) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  // Only render the verification URL as a link when it is a safe https URL —
  // it is server-controlled, but rendering an unvalidated `href` would let a
  // buggy or compromised plugin response inject a `javascript:` navigation.
  const safeVerifyUrl = isSafeAuthUrl(device.verifyUrl);
  // Parse the hostname regardless of scheme so we can show a fallback hint
  // when the URL is rejected as unsafe (e.g. a future plugin returns http://).
  const host = (() => {
    try {
      return new URL(device.verifyUrl).hostname;
    } catch {
      return device.verifyUrl;
    }
  })();

  return (
    <div className="flex flex-col gap-4">
      {safeVerifyUrl ? (
        <a
          href={device.verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <ExternalLinkIcon className="size-3.5" />
          {m.settings_connections_modal_device_open({ host })}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">
          {m.settings_connections_modal_device_unsafe_url_hint({ host })}
        </p>
      )}
      <div className="flex items-center gap-4 rounded-lg border border-dashed border-input bg-background px-4 py-3.5">
        <div className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {m.settings_connections_modal_device_enter_code()}
          </span>
          {/* `select-all` plus the adjacent CopyButton provide the real
              affordances. A pointer-only click-to-select handler with an
              aria-label on a non-interactive span was unreachable by keyboard
              and dropped by many assistive technologies, so it was removed. */}
          <span className="font-mono text-2xl tracking-[0.2em] tabular-nums select-all">
            {device.userCode}
          </span>
        </div>
        <CopyButton
          value={device.userCode}
          label={m.settings_connections_modal_device_copy()}
          variant="outline"
          size="sm"
        />
      </div>
      <div className="flex items-center gap-2.5 rounded-md border border-primary/30 bg-primary/10 px-3.5 py-2.5">
        <span className="relative inline-flex size-2.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
        </span>
        <span className="flex-1 text-xs text-primary">
          {m.settings_connections_modal_device_waiting()}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-primary/80">
          <ClockIcon className="size-3" />
          {mm}:{ss}
        </span>
      </div>
    </div>
  );
}

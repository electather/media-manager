import { env } from "../../env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Single seam for transactional email (Better Auth hooks + unit-test mocking point).
 * `EMAIL_PROVIDER_CONFIGURED=false`: no-ops (the default). `=true`: throws — no real adapter is
 * wired, and silently returning would drop verification, password-reset, and email-change flows.
 */
export async function sendEmail(_message: OutboundEmail): Promise<void> {
  if (!env.EMAIL_PROVIDER_CONFIGURED) {
    return;
  }
  // EMAIL_PROVIDER_CONFIGURED is true but no real provider is wired. Throw so
  // misconfiguration surfaces immediately rather than silently dropping emails
  // (verification, password-reset, email-change flows would all silently fail).
  // The message (including recipient address) is intentionally omitted from
  // the thrown error to avoid leaking PII into logs and error-tracking tools.
  throw new Error(
    `sendEmail called with EMAIL_PROVIDER_CONFIGURED=true but no email provider is implemented. ` +
      `Wire an SMTP/SES/Resend adapter before enabling this flag.`,
  );
}

export function isEmailEnabled(): boolean {
  return env.EMAIL_PROVIDER_CONFIGURED;
}

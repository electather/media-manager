import { env } from "../../env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Single point of integration for transactional email.
 *
 * Behavior:
 * - `EMAIL_PROVIDER_CONFIGURED=false`: no-ops, so callers don't need to
 *   branch on the env flag themselves.
 * - `EMAIL_PROVIDER_CONFIGURED=true`: throws immediately. The real provider
 *   integration (SMTP/SES/Resend/etc.) is out of scope for v1; flipping the
 *   flag without wiring an adapter would silently drop verification,
 *   password-reset, and email-change flows, so we surface the
 *   misconfiguration instead.
 *
 * This wrapper exists so the Better Auth hooks have a stable seam to call
 * and so unit tests can mock a single function.
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

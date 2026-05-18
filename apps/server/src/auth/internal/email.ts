import { consola } from "consola";
import { env } from "../../env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Single point of integration for transactional email. When the deployment
 * has no email provider configured, this no-ops so callers don't need to
 * branch on the env flag themselves.
 *
 * The real provider integration (SMTP/SES/Resend/etc.) is out of scope for
 * v1; this wrapper exists so the Better Auth hooks have a stable seam to
 * call and so unit tests can mock a single function.
 */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (!env.EMAIL_PROVIDER_CONFIGURED) {
    return;
  }
  consola.info(`[email] would send to ${message.to}: ${message.subject}`);
}

export function isEmailEnabled(): boolean {
  return env.EMAIL_PROVIDER_CONFIGURED;
}
